/**
 * One-time phone normalization (#19 data migration).
 *
 * Reads DB connection details from the environment (SUPABASE_URL,
 * SUPABASE_ANON_KEY, APP_DB_SECRET), fetches every officer row via PostgREST,
 * normalizes any phone that has EXACTLY 10 digits to "(XXX) XXX-XXXX", PATCHes
 * only the rows whose phone actually changed, and prints a summary.
 *
 * Numbers that are not 10 digits after stripping non-digits are LEFT AS-IS
 * (never destroy data) and reported as skipped.
 *
 * Usage (DEV):
 *   set -a && source .env.dev && set +a && npx tsx scripts/normalize-phones.ts
 *
 * The same script is run against prod at publish time by the main agent.
 */
import { normalizePhone, phoneDigits } from "../shared/validation";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const APP_DB_SECRET = process.env.APP_DB_SECRET;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("[normalize-phones] SUPABASE_URL and SUPABASE_ANON_KEY must be set (source .env.dev first).");
  process.exit(1);
}

const REST = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/officers`;
const headers: Record<string, string> = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
  ...(APP_DB_SECRET ? { "x-app-secret": APP_DB_SECRET } : {}),
};

type Row = { id: number; firstName: string; lastName: string; phone: string | null };

async function main() {
  const listRes = await fetch(`${REST}?select=id,firstName,lastName,phone`, { headers });
  if (!listRes.ok) {
    console.error(`[normalize-phones] Failed to fetch officers: ${listRes.status} ${await listRes.text()}`);
    process.exit(1);
  }
  const rows: Row[] = await listRes.json();

  let changed = 0, unchanged = 0, empty = 0, skipped = 0, failed = 0;
  const skippedSamples: string[] = [];

  for (const r of rows) {
    const cur = (r.phone ?? "").trim();
    if (!cur) { empty++; continue; }
    const digits = phoneDigits(cur);
    if (digits.length !== 10) {
      skipped++;
      if (skippedSamples.length < 20) skippedSamples.push(`#${r.id} ${r.lastName}, ${r.firstName}: "${cur}" (${digits.length} digits)`);
      continue;
    }
    const norm = normalizePhone(cur);
    if (norm === cur) { unchanged++; continue; }

    const patchRes = await fetch(`${REST}?id=eq.${r.id}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ phone: norm }),
    });
    if (!patchRes.ok) {
      failed++;
      console.error(`  ! PATCH failed for #${r.id}: ${patchRes.status} ${await patchRes.text()}`);
      continue;
    }
    changed++;
    console.log(`  ✓ #${r.id} ${r.lastName}, ${r.firstName}: "${cur}" → "${norm}"`);
  }

  console.log("\n=== normalize-phones summary ===");
  console.log(`Total officers:        ${rows.length}`);
  console.log(`Normalized (updated):  ${changed}`);
  console.log(`Already canonical:     ${unchanged}`);
  console.log(`Empty (no phone):      ${empty}`);
  console.log(`Skipped (not 10-digit, left as-is): ${skipped}`);
  console.log(`Failed PATCH:          ${failed}`);
  if (skippedSamples.length) {
    console.log("\nSkipped rows (untouched):");
    for (const s of skippedSamples) console.log(`  - ${s}`);
    if (skipped > skippedSamples.length) console.log(`  … and ${skipped - skippedSamples.length} more`);
  }
}

main().catch((e) => { console.error("[normalize-phones] error:", e); process.exit(1); });
