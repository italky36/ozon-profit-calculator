import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH ?? "data/app.db";

const sqlite = new Database(DB_PATH);
sqlite.pragma("foreign_keys = ON");

const rl = readline.createInterface({ input, output });

const emailRaw = (await rl.question("Email: ")).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
  console.error("Invalid email format");
  process.exit(1);
}

const password = await rl.question("Password (min 8 chars): ");
if (password.length < 8) {
  console.error("Password too short");
  process.exit(1);
}

const roleRaw = (await rl.question("Role (admin/user) [admin]: ")).trim() || "admin";
if (roleRaw !== "admin" && roleRaw !== "user") {
  console.error("Role must be 'admin' or 'user'");
  process.exit(1);
}

rl.close();

const existing = sqlite
  .prepare("SELECT id FROM users WHERE email = ?")
  .get(emailRaw);
if (existing) {
  console.error(`User ${emailRaw} already exists (id=${existing.id})`);
  process.exit(1);
}

const now = Date.now();
const passwordHash = bcrypt.hashSync(password, 10);
const result = sqlite
  .prepare(
    "INSERT INTO users (email, password_hash, role, is_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
  )
  .run(emailRaw, passwordHash, roleRaw, now, now);

console.log(
  `\n✅ Created ${roleRaw} ${emailRaw} (id=${Number(result.lastInsertRowid)})`,
);

sqlite.close();
