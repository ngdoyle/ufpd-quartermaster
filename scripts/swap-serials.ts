/**
 * swap-serials.ts — Replace placeholder firearm serial numbers with real ones.
 *
 * PURPOSE
 *   When demoing the app you may seed firearms with placeholder serials
 *   (e.g. SN-DEMO-001) to keep real ATF-registered serials out of a shared /
 *   public deployment. Once the app lives in a private, approved instance,
 *   this script swaps the placeholders for the real values in a single pass.
 *
 * SECURITY
 *   - Run this ONLY against your private/production database, never the public
 *     demo. The mapping file (serial-map.csv) holds the real serials and must
 *     NEVER be committed to git or uploaded to a deployment.
 *   - The DB is encrypted (SQLCipher); the same DB_ENCRYPTION_KEY used to run
 *     the app is required here.
 *
 * MAPPING FILE FORMAT (CSV, with header)
 *   placeholder,real
 *   SN-DEMO-001,AGX9921144
 *   SN-DEMO-002,AGX9921145
 *   ...
 *   (Optional 3rd column "name" is ignored by the swap but handy for your notes.)
 *
 * USAGE
 *   # Dry run (default) — shows what WOULD change, writes nothing:
 *   DB_ENCRYPTION_KEY=$(cat /path/to/.qm_db_key) \
 *     npx tsx scripts/swap-serials.ts ./serial-map.csv
 *
 *   # Apply the changes for real:
 *   DB_ENCRYPTION_KEY=$(cat /path/to/.qm_db_key) \
 *     npx tsx scripts/swap-serials.ts ./serial-map.csv --apply
 *
 * NOTES
 *   - Matches BOTH the core serial_number column (firearms) AND the
 *     frontPanelSerial / backPanelSerial keys inside the attributes JSON
 *     (ballistic vests).
 *   - A backup copy of data.db is written before any change in --apply mode.
 */

import Database from "better-sqlite3-multiple-ciphers";
import { readFileSync, copyFileSync, existsSync } from "fs";
import { resolve } from "path";

// ---- args -----------------------------------------------------------------
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const mapPath = args.find((a) => !a.startsWith("--"));

if (!mapPath) {
  console.error("Usage: npx tsx scripts/swap-serials.ts <mapping.csv> [--apply]");
  process.exit(1);
}

const DB_KEY = process.env.DB_ENCRYPTION_KEY;
if (!DB_KEY) {
  console.error("[abort] DB_ENCRYPTION_KEY is not set. Provide the same key used to run the app.");
  process.exit(1);
}

const DB_PATH = resolve(process.cwd(), "data.db");
if (!existsSync(DB_PATH)) {
  console.error(`[abort] Could not find data.db at ${DB_PATH}. Run this from the project root.`);
  process.exit(1);
}

// ---- parse mapping --------------------------------------------------------
function parseCsv(text: string): { placeholder: string; real: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  // detect + skip header row
  const first = lines[0].toLowerCase();
  const start = first.includes("placeholder") && first.includes("real") ? 1 : 0;
  const rows: { placeholder: string; real: string }[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const placeholder = cols[0];
    const real = cols[1];
    if (!placeholder || !real) {
      console.warn(`[skip] line ${i + 1}: needs both placeholder and real value -> "${lines[i]}"`);
      continue;
    }
    rows.push({ placeholder, real });
  }
  return rows;
}

const mapping = parseCsv(readFileSync(resolve(process.cwd(), mapPath), "utf8"));
if (mapping.length === 0) {
  console.error("[abort] mapping file is empty or unparseable.");
  process.exit(1);
}

const byPlaceholder = new Map(mapping.map((m) => [m.placeholder, m.real]));
console.log(`Loaded ${mapping.length} serial mapping(s) from ${mapPath}`);
console.log(apply ? "MODE: APPLY (changes will be written)" : "MODE: DRY RUN (no changes written)\n");

// ---- backup (apply mode only) --------------------------------------------
if (apply) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${DB_PATH}.bak-${stamp}`;
  copyFileSync(DB_PATH, backup);
  console.log(`Backup written: ${backup}\n`);
}

// ---- open encrypted DB ----------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("cipher='sqlcipher'");
db.pragma(`key='${DB_KEY.replace(/'/g, "''")}'`);

type ItemRow = { id: number; name: string; serial_number: string | null; attributes: string | null };
const items = db.prepare("SELECT id, name, serial_number, attributes FROM items").all() as ItemRow[];

let coreHits = 0;
let attrHits = 0;
const unmatched = new Set(byPlaceholder.keys());

const updateCore = db.prepare("UPDATE items SET serial_number = ? WHERE id = ?");
const updateAttrs = db.prepare("UPDATE items SET attributes = ? WHERE id = ?");

const run = db.transaction(() => {
  for (const it of items) {
    // 1) core serial_number column (firearms)
    if (it.serial_number && byPlaceholder.has(it.serial_number)) {
      const real = byPlaceholder.get(it.serial_number)!;
      console.log(`  [serial]  #${it.id} "${it.name}":  ${it.serial_number}  ->  ${real}`);
      unmatched.delete(it.serial_number);
      coreHits++;
      if (apply) updateCore.run(real, it.id);
    }

    // 2) attributes JSON panel serials (ballistic vests)
    if (it.attributes) {
      let attrs: Record<string, unknown>;
      try {
        attrs = JSON.parse(it.attributes);
      } catch {
        continue;
      }
      let changed = false;
      for (const key of ["frontPanelSerial", "backPanelSerial"]) {
        const v = attrs[key];
        if (typeof v === "string" && byPlaceholder.has(v)) {
          const real = byPlaceholder.get(v)!;
          console.log(`  [${key}] #${it.id} "${it.name}":  ${v}  ->  ${real}`);
          unmatched.delete(v);
          attrs[key] = real;
          changed = true;
          attrHits++;
        }
      }
      if (changed && apply) updateAttrs.run(JSON.stringify(attrs), it.id);
    }
  }
});

run();

// ---- summary --------------------------------------------------------------
console.log(`\n--- summary ---`);
console.log(`Core serial_number swaps: ${coreHits}`);
console.log(`Panel serial swaps:       ${attrHits}`);
console.log(`Total swaps:              ${coreHits + attrHits}`);
if (unmatched.size > 0) {
  console.log(`\nWARNING: ${unmatched.size} placeholder(s) in the mapping had NO match in the DB:`);
  for (const p of unmatched) console.log(`  - ${p}`);
}
if (!apply) {
  console.log(`\nThis was a DRY RUN. Re-run with --apply to write these changes.`);
}

db.close();
