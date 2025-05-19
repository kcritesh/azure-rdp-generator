import fs from "fs";
const DB_PATH = "./vms.json";

let db = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH)) : {};

export function saveCreds(name, creds) {
  db[name] = creds;
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function getCreds(name) {
  return db[name];
}

export function listSaved() {
  return Object.entries(db).map(([name, info]) => `${name} - ${info.username}`).join("\n");
}
