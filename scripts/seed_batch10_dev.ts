/**
 * Batch 10 DEV-only report fixture.
 *
 * Run with `.env.dev` loaded:
 *   set -a && source .env.dev && set +a && npx tsx scripts/seed_batch10_dev.ts
 *
 * This script refuses to contact any project other than the explicitly
 * approved development Supabase project and uses the PostgREST API directly.
 */
const DEV_PROJECT_REF = "ukunfveucszeaochwcyz";
const SHOTGUN_NAME = "Mossberg 590A1 Shotgun (LLIM)";

const baseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const appSecret = process.env.APP_DB_SECRET;

if (!baseUrl?.includes(DEV_PROJECT_REF)) {
  throw new Error("Refusing to seed: SUPABASE_URL is not the approved DEV project.");
}
if (!anonKey || !appSecret) {
  throw new Error("SUPABASE_ANON_KEY and APP_DB_SECRET are required.");
}

const headers = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
  "x-app-secret": appSecret,
  "Content-Type": "application/json",
};

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  // PostgREST returns an empty 201 body for inserts unless return=representation
  // is requested, so parse only when a response body is actually present.
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

const existing = await request(
  `items?select=id&name=eq.${encodeURIComponent(SHOTGUN_NAME)}&category=eq.Firearms&subcategory=eq.${encodeURIComponent("Shotgun (Less Lethal)")}`,
) as { id: number }[];

let itemId = existing[0]?.id;
if (!itemId) {
  const created = await request("items", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      name: SHOTGUN_NAME,
      category: "Firearms",
      subcategory: "Shotgun (Less Lethal)",
      type: "unique",
      sku: "",
      serialNumber: "",
      size: "",
      color: "",
      quantity: 4,
      parLevel: 0,
      location: "Armory",
      unitCost: 0,
      vendor: "",
      grantNumber: "",
      expirationDate: "",
      condition: "GOOD",
      status: "in_stock",
      returnBehavior: "returnable",
      requiresInspection: false,
      requiresDualSerial: false,
      lastInspected: "",
      attributes: "",
      notes: "Batch 10 DEV report fixture",
      createdAt: new Date().toISOString(),
    }),
  }) as { id: number }[];
  itemId = created[0].id;
}

const existingUnits = await request(
  `item_units?select=serialNumber&itemId=eq.${itemId}`,
) as { serialNumber: string }[];
const knownSerials = new Set(existingUnits.map((unit) => unit.serialNumber));
const units = ["SG-0001", "SG-0002", "SG-0003", "SG-0004"]
  .filter((serialNumber) => !knownSerials.has(serialNumber))
  .map((serialNumber) => ({
    itemId,
    serialNumber,
    secondarySerialNumber: null,
    status: "in_stock",
    condition: "GOOD",
    assignedOfficerId: null,
    location: "Armory",
    acquiredDate: "",
    notes: "Batch 10 DEV report fixture",
    createdAt: new Date().toISOString(),
  }));

if (units.length) await request("item_units", { method: "POST", body: JSON.stringify(units) });
console.log(`Batch 10 DEV fixture ready: ${SHOTGUN_NAME} (item ${itemId}; ${units.length} unit(s) added).`);
