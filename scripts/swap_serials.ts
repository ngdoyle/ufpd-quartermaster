/**
 * swap_serials.ts — swap item_unit serial numbers from a CSV map (Supabase).
 *
 * Reads a CSV whose first two columns are the current and replacement serial:
 *
 *     old_serial,new_serial
 *     SN-DEMO-001,AGX9921144
 *     SN-DEMO-002,AGX9921145
 *
 * (A legacy header of `placeholder,real` is also accepted; extra columns are
 * ignored.) For each row it finds the item_unit whose serialNumber = old_serial
 * and updates it to new_serial. Per-row outcome is printed:
 *   swapped · old not found · new already exists (skipped)
 *
 * USAGE
 *   npx tsx scripts/swap_serials.ts <map.csv> [--dry-run] [--env <path>]
 *   npx tsx scripts/swap_serials.ts --file <map.csv> [--dry-run] [--env <path>]
 *
 *   --dry-run   show what would change; write nothing
 *   --env       env file to load (default .env.dev); point at a prod env file
 *               to run against production
 *
 * Requires SUPABASE_URL, SUPABASE_ANON_KEY, APP_DB_SECRET in the env file.
 */
import { readFileSync } from "node:fs";
import { parseArgs, resolvePg, pgSelect, pgPatch } from "./_pg";

const { opts, flags, positionals } = parseArgs(process.argv.slice(2));

if (flags.has("help") || flags.has("h")) {
  console.log(`swap_serials.ts — swap item_unit serials from a CSV map (Supabase)

Usage:
  npx tsx scripts/swap_serials.ts <map.csv> [--dry-run] [--env <path>]

CSV columns (header required): old_serial,new_serial
Flags:
  --dry-run   preview changes without writing
  --env       env file (default .env.dev)`);
  process.exit(0);
}

const csvPath = opts.file ?? positionals[0];
if (!csvPath) {
  console.error("Usage: npx tsx scripts/swap_serials.ts <map.csv> [--dry-run] [--env <path>]");
  process.exit(1);
}
const dryRun = flags.has("dry-run");

function parseCsv(text: string): { oldSerial: string; newSerial: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const hasHeader =
    (first.includes("old_serial") && first.includes("new_serial")) ||
    (first.includes("placeholder") && first.includes("real"));
  const rows: { oldSerial: string; newSerial: string }[] = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const oldSerial = cols[0];
    const newSerial = cols[1];
    if (!oldSerial || !newSerial) {
      console.warn(`[skip] line ${i + 1}: needs both old_serial and new_serial → "${lines[i]}"`);
      continue;
    }
    rows.push({ oldSerial, newSerial });
  }
  return rows;
}

const inList = (vals: string[]) => `(${vals.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")})`;

async function main() {
  const { cfg, envPath } = resolvePg(opts);
  const map = parseCsv(readFileSync(csvPath, "utf8"));
  if (map.length === 0) {
    console.error("[abort] mapping file is empty or unparseable.");
    process.exit(1);
  }

  console.log(`Env: ${envPath} (project ${cfg.label})`);
  console.log(`Loaded ${map.length} serial mapping(s) from ${csvPath}`);
  console.log(dryRun ? "MODE: DRY RUN (no writes)\n" : "MODE: APPLY (writes changes)\n");

  const olds = map.map((m) => m.oldSerial);
  const news = map.map((m) => m.newSerial);

  // Batch reads to avoid N+1: fetch all units matching any old or new serial.
  const oldRows = await pgSelect<{ id: number; itemId: number; serialNumber: string }>(
    cfg, "item_units", `select=id,itemId,serialNumber&serialNumber=in.${inList(olds)}`,
  );
  const newRows = await pgSelect<{ serialNumber: string }>(
    cfg, "item_units", `select=serialNumber&serialNumber=in.${inList(news)}`,
  );
  const byOld = new Map(oldRows.map((r) => [r.serialNumber, r]));
  const existingNew = new Set(newRows.map((r) => r.serialNumber));

  let swapped = 0, notFound = 0, skipped = 0;
  for (const { oldSerial, newSerial } of map) {
    const unit = byOld.get(oldSerial);
    if (!unit) {
      console.log(`  [not found] ${oldSerial} — no item_unit with this serial`);
      notFound++;
      continue;
    }
    if (existingNew.has(newSerial)) {
      console.log(`  [skip] ${oldSerial} → ${newSerial} — new serial already exists`);
      skipped++;
      continue;
    }
    console.log(`  [swap]  unit #${unit.id} (item ${unit.itemId}): ${oldSerial} → ${newSerial}`);
    if (!dryRun) {
      await pgPatch(cfg, "item_units", `id=eq.${unit.id}`, { serialNumber: newSerial });
      existingNew.add(newSerial); // guard against duplicate new serials within the same map
    }
    swapped++;
  }

  console.log(`\n--- summary ---`);
  console.log(`Swapped:            ${swapped}${dryRun ? " (would swap)" : ""}`);
  console.log(`Old not found:      ${notFound}`);
  console.log(`New already exists: ${skipped}`);
  if (dryRun) console.log(`\nThis was a DRY RUN. Re-run without --dry-run to apply.`);
}

main().catch((e) => {
  console.error("[error]", e instanceof Error ? e.message : e);
  process.exit(1);
});
