/**
 * clean_slate.ts — wipe TRANSACTIONAL data only (Supabase).
 *
 * Deletes:  assignments, audit_log, email_log
 * Resets:   item_units that are issued/assigned → status "in_stock",
 *           assignedOfficerId = null
 * Preserves (rows untouched): users, officers, items, item_units (the rows
 *           themselves), item_variants, kits, kit_items
 *
 * IMPORTANT — stock quantities are NOT restored. Issuance decrements
 * items.quantity and item_variants.quantity at issue time; returns increment
 * them back. Because a bare wipe cannot know the original stock levels, this
 * script does NOT touch quantity fields. After running, verify/correct on-hand
 * counts manually if issued stock was outstanding.
 *
 * USAGE
 *   npx tsx scripts/clean_slate.ts --confirm WIPE [--env <path>]
 *   npx tsx scripts/clean_slate.ts --dry-run [--env <path>]
 *
 *   --confirm WIPE   required (exact) for a real run; refuses otherwise
 *   --dry-run        print row counts that would be deleted/reset; write nothing
 *   --env            env file (default .env.dev); point at a prod env file to
 *                    run against production
 *
 * A full JSON backup of all 10 tables is written to
 * backups/clean_slate_<timestamp>/ BEFORE anything is deleted; the run aborts
 * if any table backup fails. Requires SUPABASE_URL, SUPABASE_ANON_KEY,
 * APP_DB_SECRET in the env file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs, resolvePg, pgSelect, pgPatch, pgDelete, pgCount, type PgConfig } from "./_pg";

const ALL_TABLES = [
  "users", "officers", "items", "item_units", "item_variants",
  "assignments", "kits", "kit_items", "audit_log", "email_log",
] as const;

const DELETE_TABLES = ["assignments", "audit_log", "email_log"] as const;

const { opts, flags } = parseArgs(process.argv.slice(2));

if (flags.has("help") || flags.has("h")) {
  console.log(`clean_slate.ts — wipe transactional data only (Supabase)

Usage:
  npx tsx scripts/clean_slate.ts --confirm WIPE [--env <path>]
  npx tsx scripts/clean_slate.ts --dry-run [--env <path>]

Deletes: assignments, audit_log, email_log
Resets:  issued/assigned item_units → in_stock, assignedOfficerId null
Keeps:   users, officers, items, item_units rows, item_variants, kits, kit_items
Note:    stock quantities are NOT restored — verify counts afterward.

Flags:
  --confirm WIPE   required (exact) for a real run
  --dry-run        preview counts, write nothing
  --env            env file (default .env.dev)`);
  process.exit(0);
}

const dryRun = flags.has("dry-run");

// Units considered "transactional state" to reset: issued or with an officer.
const RESET_FILTER = "or=(status.eq.issued,assignedOfficerId.not.is.null)";

async function backupAll(cfg: PgConfig): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = resolve(process.cwd(), "backups", `clean_slate_${stamp}`);
  mkdirSync(dir, { recursive: true });
  for (const table of ALL_TABLES) {
    try {
      const rows = await pgSelect(cfg, table, "select=*");
      writeFileSync(resolve(dir, `${table}.json`), JSON.stringify(rows, null, 2));
      console.log(`  backed up ${table}: ${rows.length} row(s)`);
    } catch (e) {
      console.error(`[abort] backup of "${table}" failed: ${e instanceof Error ? e.message : e}`);
      console.error("No data was deleted.");
      process.exit(1);
    }
  }
  return dir;
}

async function main() {
  const { cfg, envPath } = resolvePg(opts);
  console.log(`Env: ${envPath} (project ${cfg.label})`);

  const counts = {
    assignments: await pgCount(cfg, "assignments"),
    audit_log: await pgCount(cfg, "audit_log"),
    email_log: await pgCount(cfg, "email_log"),
    unitsToReset: await pgCount(cfg, "item_units", `${RESET_FILTER}&select=id`),
  };

  console.log(`\nTransactional data present:`);
  console.log(`  assignments to delete:  ${counts.assignments}`);
  console.log(`  audit_log to delete:    ${counts.audit_log}`);
  console.log(`  email_log to delete:    ${counts.email_log}`);
  console.log(`  item_units to reset:    ${counts.unitsToReset}`);

  if (dryRun) {
    console.log(`\nDRY RUN — nothing was changed.`);
    return;
  }

  if (opts.confirm !== "WIPE") {
    console.error(`\n[refused] This is a destructive wipe. Re-run with exactly:  --confirm WIPE`);
    console.error(`(or use --dry-run to preview counts).`);
    process.exit(1);
  }

  console.log(`\nTaking full JSON backup of all ${ALL_TABLES.length} tables first…`);
  const backupDir = await backupAll(cfg);
  console.log(`Backup complete: ${backupDir}`);

  console.log(`\nDeleting transactional data…`);
  const deleted: Record<string, number> = {};
  for (const table of DELETE_TABLES) {
    const rows = await pgDelete(cfg, table, "id=gte.0");
    deleted[table] = rows.length;
    console.log(`  deleted ${table}: ${rows.length}`);
  }

  const resetRows = await pgPatch(cfg, "item_units", RESET_FILTER, {
    status: "in_stock",
    assignedOfficerId: null,
  });
  console.log(`  reset item_units: ${resetRows.length}`);

  console.log(`\n--- clean slate complete ---`);
  console.log(`Deleted: assignments=${deleted.assignments}, audit_log=${deleted.audit_log}, email_log=${deleted.email_log}`);
  console.log(`Reset item_units: ${resetRows.length}`);
  console.log(`Backup: ${backupDir}`);
  console.log(`NOTE: stock quantities were NOT restored — verify on-hand counts.`);
}

main().catch((e) => {
  console.error("[error]", e instanceof Error ? e.message : e);
  process.exit(1);
});
