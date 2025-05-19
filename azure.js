import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";

function execAz(cmd) {
  return execSync(`az ${cmd}`, { encoding: "utf8" });
}

function generatePassword(length = 12) {
  // Ensure length is within Azure limits (12-123 characters)
  length = Math.max(12, Math.min(length, 123));

  // Generate initial random password
  let password = crypto.randomBytes(length).toString("base64").slice(0, length);

  // Check if password meets complexity requirements (3 of 4 character types)
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const requirementsMet =
    [hasLowercase, hasUppercase, hasNumber, hasSpecial].filter(Boolean)
      .length >= 3;

  // If requirements not met, regenerate with explicit character types
  if (!requirementsMet) {
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const special = "!@#$%^&*()-_=+[]{}|;:,.<>?";

    let chars = "";
    chars += hasLowercase ? "" : lowercase;
    chars += hasUppercase ? "" : uppercase;
    chars += hasNumber ? "" : numbers;
    chars += hasSpecial ? "" : special;

    // Ensure we have at least 3 character types
    if (!hasLowercase) password = replaceRandomChar(password, lowercase);
    if (!hasUppercase) password = replaceRandomChar(password, uppercase);
    if (!hasNumber) password = replaceRandomChar(password, numbers);
    if (
      !hasSpecial &&
      [hasLowercase, hasUppercase, hasNumber].filter(Boolean).length < 2
    ) {
      password = replaceRandomChar(password, special);
    }
  }

  return password;
}

// Helper function to replace a random character in the password
function replaceRandomChar(str, charSet) {
  const index = Math.floor(Math.random() * str.length);
  const randomChar = charSet.charAt(Math.floor(Math.random() * charSet.length));
  return str.substring(0, index) + randomChar + str.substring(index + 1);
}

export function createVM(vmName, resourceGroup, location, username) {
  const password = generatePassword();
  execAz(`vm create --name ${vmName} --resource-group ${resourceGroup} \
    --image Win2022Datacenter --size Standard_B2s \
    --admin-username ${username} --admin-password "${password}" \
    --location ${location} --authentication-type password \
    --custom-data init.ps1 --public-ip-sku Basic`);

  execAz(
    `vm open-port --port 3389 --resource-group ${resourceGroup} --name ${vmName}`
  );

  return { username, password };
}

export function getIP(vmName, resourceGroup) {
  const json = execAz(
    `vm show -d -g ${resourceGroup} -n ${vmName} --query publicIps -o tsv`
  );
  return json.trim();
}

export function listVMs(resourceGroup) {
  return execAz(`vm list -g ${resourceGroup} -d -o table`);
}

export function startVM(vmName, resourceGroup) {
  return execAz(`vm start -n ${vmName} -g ${resourceGroup}`);
}

export function stopVM(vmName, resourceGroup) {
  return execAz(`vm deallocate -n ${vmName} -g ${resourceGroup}`);
}

export async function deleteVM(vmName, resourceGroup) {
  try {
    // First get information about resources before deleting VM
    console.log(`Getting VM resources information for ${vmName}...`);
    let diskInfo = null;
    try {
      // Get OS disk information before deleting the VM
      const diskId = execAz(
        `vm show -g ${resourceGroup} -n ${vmName} --query "storageProfile.osDisk.managedDisk.id" -o tsv`
      );
      if (diskId && diskId.trim()) {
        diskInfo = {
          id: diskId.trim(),
          name: diskId.trim().split("/").pop(),
        };
        console.log(`Found OS disk: ${diskInfo.name}`);
      }
    } catch (error) {
      console.log(`Could not retrieve OS disk information: ${error.message}`);
    }

    // Get NIC information before deleting VM
    const nicNames = [];
    try {
      const nics = execAz(
        `network nic list -g ${resourceGroup} --query "[?virtualMachine.id && contains(virtualMachine.id, '${vmName}')].name" -o tsv`
      );
      if (nics && nics.trim()) {
        nics
          .trim()
          .split("\n")
          .forEach((nic) => {
            if (nic.trim()) nicNames.push(nic.trim());
          });
        console.log(`Found NICs: ${nicNames.join(", ")}`);
      }
    } catch (error) {
      console.log(`Could not retrieve NICs information: ${error.message}`);
    }

    // Delete the VM and wait until it's gone
    console.log(`Deleting VM ${vmName}...`);
    execAz(`vm delete --yes -g ${resourceGroup} -n ${vmName}`);

    // Wait until VM is really deleted before continuing (with timeout)
    let vmExists = true;
    let tries = 0;
    const maxTries = 24; // 2 minutes timeout (24 * 5 seconds)
    while (vmExists && tries < maxTries) {
      try {
        execAz(`vm show -g ${resourceGroup} -n ${vmName}`);
        console.log(
          `Waiting for VM ${vmName} to be deleted... (${tries + 1}/${maxTries})`
        );
        await new Promise((r) => setTimeout(r, 5000));
        tries++;
      } catch {
        // vm show fails if VM doesn't exist — means deletion done
        vmExists = false;
        console.log(`VM ${vmName} successfully deleted`);
      }
    }

    if (vmExists) {
      console.log(
        `Warning: Timeout reached while waiting for VM ${vmName} to be deleted`
      );
    }

    // Delete NICs that we collected earlier
    if (nicNames.length > 0) {
      console.log(`Deleting NICs linked to VM ${vmName}...`);
      for (const nicName of nicNames) {
        try {
          console.log(`Deleting NIC: ${nicName}`);
          execAz(`network nic delete -g ${resourceGroup} -n ${nicName}`);
        } catch (error) {
          console.log(`Error deleting NIC ${nicName}: ${error.message}`);
        }
      }
    }

    // Delete Public IPs associated with VM name prefix
    console.log(`Deleting Public IPs related to VM ${vmName}...`);
    try {
      const ips = execAz(
        `network public-ip list -g ${resourceGroup} --query "[?contains(name, '${vmName}')].name" -o tsv`
      );
      if (ips && ips.trim()) {
        const ipNames = ips
          .trim()
          .split("\n")
          .filter((ip) => ip.trim());
        for (const ipName of ipNames) {
          console.log(`Deleting Public IP: ${ipName}`);
          execAz(`network public-ip delete -g ${resourceGroup} -n ${ipName}`);
        }
      }
    } catch (error) {
      console.log(`Error listing/deleting public IPs: ${error.message}`);
    }

    // Delete Network Security Groups associated with VM
    console.log(`Deleting NSGs related to VM ${vmName}...`);
    try {
      const nsgs = execAz(
        `network nsg list -g ${resourceGroup} --query "[?contains(name, '${vmName}')].name" -o tsv`
      );
      if (nsgs && nsgs.trim()) {
        const nsgNames = nsgs
          .trim()
          .split("\n")
          .filter((nsg) => nsg.trim());
        for (const nsgName of nsgNames) {
          console.log(`Deleting NSG: ${nsgName}`);
          execAz(`network nsg delete -g ${resourceGroup} -n ${nsgName}`);
        }
      }
    } catch (error) {
      console.log(`Error listing/deleting NSGs: ${error.message}`);
    }

    // Delete OS disk using the information we gathered earlier
    if (diskInfo) {
      console.log(`Deleting OS disk: ${diskInfo.name}`);
      try {
        execAz(`disk delete -g ${resourceGroup} -n "${diskInfo.name}" --yes`);
      } catch (error) {
        console.log(
          `Error deleting OS disk ${diskInfo.name}: ${error.message}`
        );
      }
    }

    console.log(`Deleted VM ${vmName} and related resources successfully.`);
    return {
      success: true,
      message: `VM ${vmName} and all associated resources deleted successfully`,
    };
  } catch (error) {
    console.error("Error deleting VM and resources:", error);
    return {
      success: false,
      message: `Failed to delete VM: ${error.message}`,
      error,
    };
  }
}
