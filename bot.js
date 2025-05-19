import TelegramBot from "node-telegram-bot-api";
import { config } from "./config.js";
import * as azure from "./azure.js";
import { saveCreds, getCreds, listSaved } from "./db.js";
import fs from "fs";

const bot = new TelegramBot(config.telegramToken, { polling: true });

function onlyOwner(ctx, next) {
  if (ctx.from.id !== config.ownerId) return ctx.reply("❌ Unauthorized.");
  next();
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome! Use /create <name> to create RDP.");
});

bot.onText(/\/create (.+)/, async (msg, match) => {
  if (msg.from.id !== config.ownerId) return;

  const name = match[1];
  bot.sendMessage(msg.chat.id, `Creating VM: ${name}...`);

  try {
    const creds = azure.createVM(
      name,
      config.azureResourceGroup,
      config.azureLocation,
      config.adminUsername
    );
    const ip = azure.getIP(name, config.azureResourceGroup);
    saveCreds(name, creds);

    bot.sendMessage(
      msg.chat.id,
      `✅ RDP Created:
🖥 IP: ${ip}
👤 Username: ${creds.username}
🔑 Password: ${creds.password}`
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(msg.chat.id, "❌ Failed to create RDP.");
  }
});

bot.onText(/\/list/, (msg) => {
  if (msg.from.id !== config.ownerId) return;
  const list = listSaved() || "No VMs saved.";
  bot.sendMessage(msg.chat.id, `📋 Saved VMs:\n${list}`);
});

bot.onText(/\/get (.+)/, (msg, match) => {
  if (msg.from.id !== config.ownerId) return;
  const name = match[1];
  const creds = getCreds(name);
  if (!creds) return bot.sendMessage(msg.chat.id, "❌ Not found.");
  const ip = azure.getIP(name, config.azureResourceGroup);
  bot.sendMessage(
    msg.chat.id,
    `📡 ${name}:
🖥 IP: ${ip}
👤 ${creds.username}
🔑 ${creds.password}`
  );
});

bot.onText(/\/startvm (.+)/, (msg, match) => {
  if (msg.from.id !== config.ownerId) return;
  const name = match[1];
  azure.startVM(name, config.azureResourceGroup);
  bot.sendMessage(msg.chat.id, `🚀 Starting VM ${name}...`);
});

bot.onText(/\/stopvm (.+)/, (msg, match) => {
  if (msg.from.id !== config.ownerId) return;
  const name = match[1];
  azure.stopVM(name, config.azureResourceGroup);
  bot.sendMessage(msg.chat.id, `🛑 Stopping VM ${name}...`);
});

bot.onText(/\/delete (.+)/, async (msg, match) => {
  if (msg.from.id !== config.ownerId) return;
  const name = match[1];

  bot.sendMessage(
    msg.chat.id,
    `Deleting VM ${name} and associated resources...`
  );

  try {
    await azure.deleteVM(name, config.azureResourceGroup);

    // Remove from local DB
    const db = JSON.parse(fs.readFileSync("./vms.json"));
    delete db[name];
    fs.writeFileSync("./vms.json", JSON.stringify(db, null, 2));

    bot.sendMessage(msg.chat.id, `✅ VM ${name} deleted successfully.`);
  } catch (e) {
    console.error(e);
    bot.sendMessage(msg.chat.id, `❌ Failed to delete VM ${name}.`);
  }
});

console.log("🤖 Bot running...");
