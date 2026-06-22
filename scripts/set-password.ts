/**
 * set-password.ts — Rotate account passwords on a live (encrypted) database.
 *
 * Sets strong bcrypt-hashed passwords for one or more accounts WITHOUT wiping
 * any data. Use this to harden the demo logins before sharing, or any time an
 * account password needs to change.
 *
 * USAGE
 *   DB_ENCRYPTION_KEY=$(cat .qm_db_key) npx tsx scripts/set-password.ts <args...>
 *
 *   Each arg is either:
 *     username             -> generate a strong random password (printed for you)
 *     username=YourPass    -> set an explicit password
 *
 *   Examples:
 *     # Auto-generate strong passwords for all three demo accounts:
 *     npx tsx scripts/set-password.ts admin quartermaster auditor
 *
 *     # Set your own:
 *     npx tsx scripts/set-password.ts admin='Gator!Armory#2026'
 *
 * NOTES
 *   - Passwords are hashed with bcrypt (cost 12) — plaintext is never stored.
 *   - A timestamped backup of data.db is written before any change.
 *   - The plaintext passwords are printed to YOUR console only. Capture them,
 *     then clear your terminal. They are not written to disk anywhere.
 *   - Run from the project root (where data.db lives).
 */

import Database from "better-sqlite3-multiple-ciphers";
import bcrypt from "bcryptjs";
import { copyFileSync as _copy, existsSync as _exists } from "fs";
import { randomBytes as _rand } from "crypto";
import { resolve } from "path";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npx tsx scripts/set-password.ts <username|username=password> [...]");
  process.exit(1);
}

const DB_KEY = process.env.DB_ENCRYPTION_KEY;
if (!DB_KEY) {
  console.error("[abort] DB_ENCRYPTION_KEY is not set. Provide the same key used to run the app.");
  process.exit(1);
}

const DB_PATH = resolve(process.cwd(), "data.db");
if (!_exists(DB_PATH)) {
  console.error(`[abort] Could not find data.db at ${DB_PATH}. Run this from the project root.`);
  process.exit(1);
}

// Generate a strong, copy/paste-friendly password (no ambiguous chars).
function strongPassword(len = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = _rand(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// Parse args into { username, password (maybe generated) }.
const targets = args.map((a) => {
  const eq = a.indexOf("=");
  if (eq === -1) return { username: a.trim(), password: strongPassword(), generated: true };
  return { username: a.slice(0, eq).trim(), password: a.slice(eq + 1), generated: false };
});

// Backup before any write.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `${DB_PATH}.bak-${stamp}`;
_copy(DB_PATH, backup);

const db = new Database(DB_PATH);
db.pragma("cipher='sqlcipher'");
db.pragma(`key='${DB_KEY.replace(/'/g, "''")}'`);

const findUser = db.prepare("SELECT id, username FROM users WHERE username = ?");
const setPw = db.prepare("UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?");

const results: { username: string; password: string; status: string }[] = [];

const run = db.transaction(() => {
  for (const t of targets) {
    const row = findUser.get(t.username) as { id: number; username: string } | undefined;
    if (!row) {
      results.push({ username: t.username, password: "", status: "NOT FOUND — skipped" });
      continue;
    }
    const hash = bcrypt.hashSync(t.password, 12);
    setPw.run(hash, row.id);
    results.push({ username: t.username, password: t.password, status: t.generated ? "updated (generated)" : "updated" });
  }
});
run();
db.close();

console.log(`Backup written: ${backup}\n`);
console.log("=== NEW CREDENTIALS (capture these, then clear your terminal) ===");
for (const r of results) {
  if (r.status.startsWith("NOT FOUND")) {
    console.log(`  ${r.username.padEnd(16)} ${r.status}`);
  } else {
    console.log(`  ${r.username.padEnd(16)} ${r.password.padEnd(20)} [${r.status}]`);
  }
}
console.log("\nPasswords are bcrypt-hashed in the DB. Plaintext shown above is NOT saved anywhere.");
