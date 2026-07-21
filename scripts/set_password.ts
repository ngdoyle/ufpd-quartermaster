/**
 * set_password.ts — set/reset a user account password (Supabase).
 *
 * Hashes the password with bcrypt at the same cost the app uses (12) and PATCHes
 * the users row. By default it also sets mustChangePassword=true so the operator
 * is forced to pick a new password at next sign-in.
 *
 * USAGE
 *   npx tsx scripts/set_password.ts --user <username> [--password <pw>] \
 *       [--no-force-change] [--env <path>]
 *
 *   --user             account username (required)
 *   --password         explicit password; if omitted a strong 16-char temp
 *                      password is generated and printed
 *   --no-force-change  do NOT set mustChangePassword (leave it as-is → false)
 *   --env              env file (default .env.dev); point at a prod env file to
 *                      run against production
 *
 * The bcrypt hash is NEVER printed or logged. Requires SUPABASE_URL,
 * SUPABASE_ANON_KEY, APP_DB_SECRET in the env file.
 */
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { parseArgs, resolvePg, pgSelect, pgPatch } from "./_pg";

// Match server/auth.ts BCRYPT_ROUNDS.
const BCRYPT_ROUNDS = 12;

const { opts, flags } = parseArgs(process.argv.slice(2));

if (flags.has("help") || flags.has("h")) {
  console.log(`set_password.ts — set/reset a user password (Supabase)

Usage:
  npx tsx scripts/set_password.ts --user <username> [--password <pw>] [--no-force-change] [--env <path>]

Flags:
  --user             username (required)
  --password         explicit password (else a strong 16-char one is generated)
  --no-force-change  do not set mustChangePassword
  --env              env file (default .env.dev)`);
  process.exit(0);
}

const username = opts.user?.trim();
if (!username) {
  console.error("[abort] --user <username> is required.");
  process.exit(1);
}

// Strong, copy/paste-friendly password (no ambiguous chars).
function strongPassword(len = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

async function main() {
  const { cfg, envPath } = resolvePg(opts);
  const generated = opts.password === undefined;
  const password = generated ? strongPassword() : opts.password;
  const forceChange = !flags.has("no-force-change");

  const users = await pgSelect<{ id: number; username: string }>(
    cfg, "users", `select=id,username&username=eq.${encodeURIComponent(username)}`,
  );
  const user = users[0];
  if (!user) {
    console.error(`[abort] no user account with username "${username}" (env ${envPath}, project ${cfg.label}).`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(String(password), BCRYPT_ROUNDS);
  await pgPatch(cfg, "users", `id=eq.${user.id}`, {
    password: hash,
    mustChangePassword: forceChange,
  });

  console.log(`Env: ${envPath} (project ${cfg.label})`);
  console.log(`Password updated for "${user.username}" (id ${user.id}).`);
  console.log(`mustChangePassword: ${forceChange}`);
  if (generated) {
    console.log(`\n=== GENERATED PASSWORD (capture now, then clear your terminal) ===`);
    console.log(`  ${username}: ${password}`);
    console.log(`\nStored as a bcrypt hash (cost ${BCRYPT_ROUNDS}); the hash is never printed.`);
  } else {
    console.log(`(The password you supplied was hashed and stored; plaintext not echoed.)`);
  }
}

main().catch((e) => {
  console.error("[error]", e instanceof Error ? e.message : e);
  process.exit(1);
});
