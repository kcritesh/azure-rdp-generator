import { execSync } from "child_process";
import crypto from "crypto";
import fs from "fs";

function execAz(cmd) {
  return execSync(`az ${cmd}`, { encoding: "utf8" });
}

function generatePassword(length = 12) {
  return crypto.randomBytes(length).toString("base64").slice(0, length);
}

export function createVM(vmName, resourceGroup, location, username) {
  const password = generatePassword();
  execAz(`vm create --name ${vmName} --resource-group ${resourceGroup} \
    --image Win2022AzureEditionCore --size Standard_B2s \
    --admin-username ${username} --admin-password "${password}" \
    --location ${location} --authentication-type password \
    --custom-data init.ps1 --public-ip-sku Basic`);

  execAz(`vm open-port --port 3389 --resource-group ${resourceGroup} --name ${vmName}`);

  return { username, password };
}

export function getIP(vmName, resourceGroup) {
  const json = execAz(`vm show -d -g ${resourceGroup} -n ${vmName} --query publicIps -o tsv`);
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
    // Delete the VM and wait until it's gone
    console.log(`Deleting VM ${vmName}...`);
    execAz(`vm delete --yes -g ${resourceGroup} -n ${vmName}`);

    // Wait until VM is really deleted before continuing
    let vmExists = true;
    while (vmExists) {
      try {
        execAz(`vm show -g ${resourceGroup} -n ${vmName}`);
        console.log(`Waiting for VM ${vmName} to be deleted...`);
        await new Promise((r) => setTimeout(r, 5000));
      } catch {
        // vm show fails if VM doesn't exist — means deletion done
        vmExists = false;
      }
    }

    // Now get NICs linked to VM — should be none if VM is deleted but check anyway
    console.log(`Deleting NICs linked to VM ${vmName}...`);
    const nics = execAz(`network nic list -g ${resourceGroup} --query "[?virtualMachine.id && contains(virtualMachine.id, '${vmName}')].name" -o tsv`);
    if (nics) {
      nics.trim().split('\n').forEach((nicName) => {
        console.log(`Deleting NIC: ${nicName}`);
        execAz(`network nic delete -g ${resourceGroup} -n ${nicName}`);
      });
    }

    // Delete Public IPs associated with VM name prefix
    console.log(`Deleting Public IPs related to VM ${vmName}...`);
    const ips = execAz(`network public-ip list -g ${resourceGroup} --query "[?contains(name, '${vmName}')].name" -o tsv`);
    if (ips) {
      ips.trim().split('\n').forEach(ipName => {
        console.log(`Deleting Public IP: ${ipName}`);
        execAz(`network public-ip delete -g ${resourceGroup} -n ${ipName}`);
      });
    }

    // Delete OS disk attached to VM
    console.log(`Deleting OS disk for VM ${vmName}...`);
    try {
      const diskId = execAz(`vm show -g ${resourceGroup} -n ${vmName} --query "storageProfile.osDisk.managedDisk.id" -o tsv`);
      if (diskId) {
        const diskName = diskId.trim().split('/').pop();
        console.log(`Deleting Disk: ${diskName}`);
        execAz(`disk delete -g ${resourceGroup} -n ${diskName} --yes`);
      }
    } catch {
      // VM info not available — probably already deleted
    }

    console.log(`Deleted VM ${vmName} and related resources successfully.`);
  } catch (error) {
    console.error("Error deleting VM and resources:", error);
    throw error;
  }
}

