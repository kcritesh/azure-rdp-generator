import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import * as azure from "./azure.js";
import { saveCreds, getCreds, listSaved } from "./db.js";
import fs from "fs";

const bot = new TelegramBot(config.telegramToken, { polling: true });

// Helper function to safely edit a message, ignoring "message not modified" errors
async function safeEditMessage(chatId, messageId, text, options = {}) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: "Markdown",
      ...options,
    });
  } catch (error) {
    // Ignore "message is not modified" errors (they're not critical)
    if (!error.message.includes("message is not modified")) {
      console.error("Telegram API error:", error.message);
    }
  }
}

// Middleware to ensure only the owner can access certain commands
function onlyOwner(msg) {
  if (msg.from.id !== config.ownerId) {
    bot.sendMessage(
      msg.chat.id,
      "❌ Unauthorized. This command is only available to the bot owner."
    );
    return false;
  }
  return true;
}

// Define available commands for help menu
const commands = [
  { command: "start", description: "Start the bot" },
  { command: "help", description: "Show available commands" },
  {
    command: "create",
    description: "Create a new RDP VM (format: /create name)",
  },
  { command: "list", description: "List all saved VMs" },
  {
    command: "get",
    description: "Get credentials for a specific VM (format: /get name)",
  },
  { command: "startvm", description: "Start a VM (format: /startvm name)" },
  { command: "stopvm", description: "Stop a VM (format: /stopvm name)" },
  {
    command: "delete",
    description: "Delete a VM and associated resources (format: /delete name)",
  },
];

// Register commands with Telegram
bot.setMyCommands(commands);

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "👋 Welcome to Azure RDP Generator Bot!\n\n" +
      "This bot helps you create and manage Windows RDP servers on Azure.\n\n" +
      "Use /help to see available commands."
  );
});

bot.onText(/\/help/, (msg) => {
  const helpText =
    "📚 *Available Commands:*\n\n" +
    commands.map((cmd) => `/${cmd.command} - ${cmd.description}`).join("\n") +
    "\n\n*Note:* Most commands are restricted to the bot owner.";

  bot.sendMessage(msg.chat.id, helpText, { parse_mode: "Markdown" });
});

bot.onText(/\/create (.+)/, async (msg, match) => {
  if (!onlyOwner(msg)) return;

  const name = match[1];

  // Progress notification
  const progressMsg = await bot.sendMessage(
    msg.chat.id,
    `🔄 Creating VM: *${name}*...\n\n` +
      "⏳ Step 1/3: Provisioning Azure resources...",
    { parse_mode: "Markdown" }
  );

  try {
    // No need to edit the message immediately after sending it as it would have the same content
    // Start creating the VM

    const creds = azure.createVM(
      name,
      config.azureResourceGroup,
      config.azureLocation,
      config.adminUsername
    );

    // Update progress
    await safeEditMessage(
      msg.chat.id,
      progressMsg.message_id,
      `🔄 Creating VM: *${name}*...\n\n` +
        "✅ Step 1/3: Azure resources provisioned\n" +
        "⏳ Step 2/3: Getting IP address..."
    );

    const ip = azure.getIP(name, config.azureResourceGroup);

    // Update progress
    await safeEditMessage(
      msg.chat.id,
      progressMsg.message_id,
      `🔄 Creating VM: *${name}*...\n\n` +
        "✅ Step 1/3: Azure resources provisioned\n" +
        "✅ Step 2/3: IP address retrieved\n" +
        "⏳ Step 3/3: Saving credentials..."
    );

    saveCreds(name, creds);

    // Final success message
    await safeEditMessage(
      msg.chat.id,
      progressMsg.message_id,
      `✅ RDP Created Successfully: *${name}*\n\n` +
        "📋 *Connection Details:*\n" +
        `🖥 IP: \`${ip}\`\n` +
        `👤 Username: \`${creds.username}\`\n` +
        `🔑 Password: \`${creds.password}\`\n\n` +
        "ℹ️ You can connect using Remote Desktop.\n" +
        "🔄 Use /startvm or /stopvm to manage this VM."
    );
  } catch (e) {
    console.error(e);
    safeEditMessage(
      msg.chat.id,
      progressMsg.message_id,
      `❌ Failed to create RDP: *${name}*\n\n` + "Error: " + e.message
    );
  }
});

bot.onText(/\/list/, (msg) => {
  if (!onlyOwner(msg)) return;

  const list = listSaved();

  if (!list || list.length === 0) {
    bot.sendMessage(msg.chat.id, "📋 *Saved VMs:*\n\nNo VMs saved.", {
      parse_mode: "Markdown",
    });
    return;
  }

  bot.sendMessage(
    msg.chat.id,
    `📋 *Saved VMs:*\n\n${list}\n\nUse /get <name> to view credentials.`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/get (.+)/, (msg, match) => {
  if (!onlyOwner(msg)) return;

  const name = match[1];
  const creds = getCreds(name);

  if (!creds) {
    bot.sendMessage(
      msg.chat.id,
      `❌ VM not found: *${name}*\n\nUse /list to see available VMs.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  try {
    const ip = azure.getIP(name, config.azureResourceGroup);
    bot.sendMessage(
      msg.chat.id,
      `📡 *VM Details: ${name}*\n\n` +
        `🖥 IP: \`${ip}\`\n` +
        `👤 Username: \`${creds.username}\`\n` +
        `🔑 Password: \`${creds.password}\`\n\n` +
        "ℹ️ You can connect using Remote Desktop.",
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(
      msg.chat.id,
      `⚠️ VM *${name}* exists in local database but may not be active on Azure.\n\n` +
        "Error: " +
        e.message,
      { parse_mode: "Markdown" }
    );
  }
});

bot.onText(/\/startvm (.+)/, async (msg, match) => {
  if (!onlyOwner(msg)) return;

  const name = match[1];

  // Progress notification
  const progressMsg = await bot.sendMessage(
    msg.chat.id,
    `🔄 Starting VM: *${name}*...\n\nThis may take a minute.`,
    { parse_mode: "Markdown" }
  );

  try {
    azure.startVM(name, config.azureResourceGroup);

    // Wait a bit for VM to initialize, then try to get IP
    setTimeout(async () => {
      try {
        const ip = azure.getIP(name, config.azureResourceGroup);

        // Only update the message if we have new information (IP)
        const newMessage =
          `🚀 VM *${name}* started successfully!\n\n` +
          `🖥 IP: \`${ip}\`\n\n` +
          "ℹ️ You can now connect using Remote Desktop.";

        safeEditMessage(msg.chat.id, progressMsg.message_id, newMessage);
      } catch (e) {
        safeEditMessage(
          msg.chat.id,
          progressMsg.message_id,
          `🚀 VM *${name}* started, but couldn't retrieve IP.\n\n` +
            "ℹ️ Use /get <name> to view details once the VM is fully started."
        );
      }
    }, 10000); // Wait 10 seconds for VM to initialize
  } catch (e) {
    console.error(e);
    safeEditMessage(
      msg.chat.id,
      progressMsg.message_id,
      `❌ Failed to start VM: *${name}*\n\n` + "Error: " + e.message
    );
  }
});

bot.onText(/\/stopvm (.+)/, async (msg, match) => {
  if (!onlyOwner(msg)) return;

  const name = match[1];

  // Progress notification
  const progressMsg = await bot.sendMessage(
    msg.chat.id,
    `🔄 Stopping VM: *${name}*...\n\nThis may take a moment.`,
    { parse_mode: "Markdown" }
  );

  try {
    azure.stopVM(name, config.azureResourceGroup);

    setTimeout(() => {
      const completionMessage =
        `🛑 VM *${name}* stopped successfully!\n\n` +
        "ℹ️ The VM is now deallocated and you won't be charged for compute resources.";

      safeEditMessage(msg.chat.id, progressMsg.message_id, completionMessage);
    }, 5000); // Wait 5 seconds for status to update
  } catch (e) {
    console.error(e);
    safeEditMessage(
      msg.chat.id,
      progressMsg.message_id,
      `❌ Failed to stop VM: *${name}*\n\n` + "Error: " + e.message
    );
  }
});

bot.onText(/\/delete (.+)/, async (msg, match) => {
  if (!onlyOwner(msg)) return;

  const name = match[1];

  // Confirmation message
  bot.sendMessage(
    msg.chat.id,
    `⚠️ Are you sure you want to delete VM *${name}* and all associated resources?\n\n` +
      "This action cannot be undone.",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ Yes, delete it",
              callback_data: `delete_confirm_${name}`,
            },
            { text: "❌ Cancel", callback_data: "delete_cancel" },
          ],
        ],
      },
    }
  );
});

// Handle callback queries for confirmation buttons
bot.on("callback_query", async (callbackQuery) => {
  const action = callbackQuery.data;
  const msg = callbackQuery.message;

  // Handle VM deletion confirmation
  if (action.startsWith("delete_confirm_")) {
    const name = action.replace("delete_confirm_", "");

    // Progress notification
    await safeEditMessage(
      msg.chat.id,
      msg.message_id,
      `🔄 Deleting VM: *${name}* and associated resources...\n\n` +
        "⏳ Step 1/3: Deleting Azure resources...",
      { reply_markup: { inline_keyboard: [] } }
    );

    try {
      await azure.deleteVM(name, config.azureResourceGroup);

      // Update progress
      await safeEditMessage(
        msg.chat.id,
        msg.message_id,
        `🔄 Deleting VM: *${name}* and associated resources...\n\n` +
          "✅ Step 1/3: Azure resources deleted\n" +
          "⏳ Step 2/3: Updating local database..."
      );

      // Remove from local DB
      const db = JSON.parse(fs.readFileSync("./vms.json"));
      delete db[name];
      fs.writeFileSync("./vms.json", JSON.stringify(db, null, 2));

      // Final update
      await safeEditMessage(
        msg.chat.id,
        msg.message_id,
        `🔄 Deleting VM: *${name}* and associated resources...\n\n` +
          "✅ Step 1/3: Azure resources deleted\n" +
          "✅ Step 2/3: Local database updated\n" +
          "✅ Step 3/3: Cleanup complete"
      );

      // Send success message
      setTimeout(() => {
        bot.sendMessage(msg.chat.id, `✅ VM *${name}* deleted successfully!`, {
          parse_mode: "Markdown",
        });
      }, 1000);
    } catch (e) {
      console.error(e);
      safeEditMessage(
        msg.chat.id,
        msg.message_id,
        `❌ Failed to delete VM: *${name}*\n\n` + "Error: " + e.message
      );
    }
  } else if (action === "delete_cancel") {
    // Handle cancel action
    safeEditMessage(
      msg.chat.id,
      msg.message_id,
      "🔄 Deletion cancelled. Your VM is safe.",
      { reply_markup: { inline_keyboard: [] } }
    );
  }

  // Answer callback query to remove loading state
  bot.answerCallbackQuery(callbackQuery.id);
});

// Handle unknown commands
bot.on("message", (msg) => {
  // Only respond to text messages that start with / but are not recognized commands
  if (
    msg.text &&
    msg.text.startsWith("/") &&
    !msg.text.match(
      /^\/(start|help|create|list|get|startvm|stopvm|delete)($|\s)/
    )
  ) {
    bot.sendMessage(
      msg.chat.id,
      "❓ Unknown command. Use /help to see available commands.",
      { reply_to_message_id: msg.message_id }
    );
  }
});

console.log("🤖 Bot running with interactive features enabled...");
