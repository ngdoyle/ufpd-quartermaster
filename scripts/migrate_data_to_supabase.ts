/**
 * migrate_data_to_supabase.ts
 * ---------------------------------------------------------------------------
 * One-shot loader that copies existing Quartermaster data into Supabase
 * (Postgres) while PRESERVING integer IDs, then advances each table's identity
 * sequence past the max imported id.
 *
 * Sources (pick one):
 *   --dir <path>   A live-backup JSON directory produced by backup_live.py
 *                  (items.json, units.json, officers.json, kits.json,
 *                  assignments.json). Rows are already camelCase (from the API)
 *                  and map 1:1 to the Postgres columns.
 *   --db  <path>   A local SQLCipher data.db (reads every table directly).
 *                  Uses DB_ENCRYPTION_KEY (or the dev default) to open it.
 *
 * Flags:
 *   --wipe         TRUNCATE ... RESTART IDENTITY CASCADE all tables first
 *                  (idempotent-safe reload). Uses the truncate_all() function.
 *
 * Requires SUPABASE_URL and SUPABASE_ANON_KEY in the environment (.env). The
 * schema (supabase/migration.sql) must already be applied.
 *
 * Usage:
 *   tsx scripts/migrate_data_to_supabase.ts --dir ../live_backup_20260715_131616 --wipe
 *   tsx scripts/migrate_data_to_supabase.ts --db ./data.db --wipe
 * ---------------------------------------------------------------------------
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("[migrate] SUPABASE_URL and SUPABASE_ANON_KEY must be set in the environment (.env).");
  process.exit(1);
}
// Mirror server/supabase.ts: send the RLS shared secret when configured so this
// loader works against a hardened project (supabase/hardening.sql).
const APP_DB_SECRET = process.env.APP_DB_SECRET;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  ...(APP_DB_SECRET
    ? { global: { headers: { "x-app-secret": APP_DB_SECRET } } }
    : {}),
});

// ---- CLI args ----
const argv = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DIR = getArg("--dir");
const DB = getArg("--db");
const WIPE = argv.includes("--wipe");

if (!DIR && !DB) {
  console.error("[migrate] Provide a source: --dir <backup-dir> OR --db <data.db>.");
  process.exit(1);
}

// Columns that are computed/attached by the API and must not be inserted.
const STRIP: Record<string, string[]> = {
  items: ["onHand", "lowStock", "unitCounts", "variantCounts"],
  assignments: ["variantSize"],
};
// Boolean columns (needed when reading integer 0/1 out of SQLite).
const BOOL_KEYS = new Set(["mustChangePassword", "active", "requiresInspection"]);

const snakeToCamel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function clean(table: string, row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...row };
  for (const k of STRIP[table] ?? []) delete out[k];
  return out;
}

type Tables = {
  officers: any[]; items: any[]; item_units: any[]; item_variants: any[];
  kits: any[]; kit_items: any[]; users: any[]; assignments: any[]; audit_log: any[];
};

function emptyTables(): Tables {
  return { officers: [], items: [], item_units: [], item_variants: [], kits: [], kit_items: [], users: [], assignments: [], audit_log: [] };
}

function loadFromDir(dir: string): Tables {
  const t = emptyTables();
  const read = (name: string): any[] | null => {
    const p = join(dir, name);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8"));
  };
  t.officers = (read("officers.json") ?? []).map((r) => clean("officers", r));
  t.items = (read("items.json") ?? []).map((r) => clean("items", r));
  // units.json is grouped as [{ itemId, units: [...] }] — flatten to unit rows.
  const unitGroups = read("units.json") ?? [];
  t.item_units = unitGroups.flatMap((g: any) => Array.isArray(g.units) ? g.units : []);
  // kits.json embeds its kit_items under `items`.
  const kits = read("kits.json") ?? [];
  t.kits = kits.map(({ items, ...k }: any) => k);
  t.kit_items = kits.flatMap((k: any) => Array.isArray(k.items) ? k.items : []);
  t.assignments = (read("assignments.json") ?? []).map((r) => clean("assignments", r));
  // Optional extras a dir backup may not contain.
  t.item_variants = (read("variants.json") ?? []).map((r) => clean("item_variants", r));
  t.users = read("users.json") ?? [];
  t.audit_log = read("audit_log.json") ?? read("audit.json") ?? [];
  return t;
}

async function loadFromDb(dbPath: string): Promise<Tables> {
  // Dynamic import so the JSON-dir path never touches the native module.
  const { default: Database } = await import("better-sqlite3-multiple-ciphers");
  const key = process.env.DB_ENCRYPTION_KEY || "dev-insecure-key-change-me";
  const sqlite = new Database(dbPath, { readonly: true });
  sqlite.pragma("cipher='sqlcipher'");
  sqlite.pragma(`key='${key.replace(/'/g, "''")}'`);

  const t = emptyTables();
  const readTable = (sqliteName: string, target: keyof Tables) => {
    const rows = sqlite.prepare(`SELECT * FROM "${sqliteName}"`).all() as Record<string, any>[];
    t[target] = rows.map((r) => {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        const ck = snakeToCamel(k);
        out[ck] = BOOL_KEYS.has(ck) ? Boolean(v) : v;
      }
      return clean(target, out);
    });
  };
  readTable("officers", "officers");
  readTable("items", "items");
  readTable("item_units", "item_units");
  readTable("item_variants", "item_variants");
  readTable("kits", "kits");
  readTable("kit_items", "kit_items");
  readTable("users", "users");
  readTable("assignments", "assignments");
  readTable("audit_log", "audit_log");
  sqlite.close();
  return t;
}

async function insertAll(table: string, rows: any[]) {
  if (rows.length === 0) { console.log(`  ${table}: 0 rows (skipped)`); return; }
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      console.error(`[migrate] insert into ${table} failed:`, error.message);
      process.exit(1);
    }
  }
  console.log(`  ${table}: ${rows.length} rows`);
}

async function main() {
  const t = DIR ? loadFromDir(DIR) : await loadFromDb(DB!);

  if (WIPE) {
    console.log("[migrate] --wipe: truncating all tables (RESTART IDENTITY CASCADE)...");
    const { error } = await supabase.rpc("truncate_all");
    if (error) { console.error("[migrate] truncate_all failed:", error.message); process.exit(1); }
  }

  console.log("[migrate] loading rows (IDs preserved)...");
  // FK-safe insertion order.
  await insertAll("officers", t.officers);
  await insertAll("items", t.items);
  await insertAll("item_units", t.item_units);
  await insertAll("item_variants", t.item_variants);
  await insertAll("kits", t.kits);
  await insertAll("kit_items", t.kit_items);
  await insertAll("users", t.users);
  await insertAll("assignments", t.assignments);
  await insertAll("audit_log", t.audit_log);

  console.log("[migrate] resetting identity sequences...");
  const { error } = await supabase.rpc("reset_sequences");
  if (error) { console.error("[migrate] reset_sequences failed:", error.message); process.exit(1); }

  console.log("[migrate] done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
