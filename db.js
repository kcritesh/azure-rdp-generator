import fs from "fs";
const DB_PATH = "./vms.json";

// Initialize the database
let db = {};

// Create vms.json with empty object if it doesn't exist or is empty
if (!fs.existsSync(DB_PATH) || fs.readFileSync(DB_PATH, "utf8").trim() === "") {
  // Ensure the directory exists (for Docker volume mounting)
  const dir = DB_PATH.substring(0, DB_PATH.lastIndexOf("/"));
  if (dir && dir !== "." && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
} else {
  try {
    db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (error) {
    console.error("Error parsing vms.json, creating new empty database");
    fs.writeFileSync(DB_PATH, JSON.stringify({}, null, 2));
  }
}

export function saveCreds(name, creds) {
  db[name] = creds;
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

export function getCreds(name) {
  return db[name];
}

export function listSaved() {
  return Object.entries(db)
    .map(([name, info]) => `${name} - ${info.username}`)
    .join("\n");
}
