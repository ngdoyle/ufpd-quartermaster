import { storage } from "./storage";
import { supabase, unwrap } from "./supabase";
import bcrypt from "bcryptjs";

const nowISO = () => new Date().toISOString();
// Seed credentials are stored as bcrypt hashes, never plaintext.
const hash = (p: string) => bcrypt.hashSync(p, 12);

// Initial passwords are supplied via environment variables so real credentials
// never live in source control. If a var is unset, a strong random password is
// generated and printed once at seed time. Rotate any time with
// scripts/set-password.ts.
import { randomBytes } from "crypto";
function strongPassword(len = 16): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const b = randomBytes(len);
  return Array.from({ length: len }, (_, i) => a[b[i] % a.length]).join("");
}
const seedPw = (envVar: string, label: string): string => {
  const v = process.env[envVar];
  if (v && v.length >= 8) return v;
  const gen = strongPassword();
  console.log(`[seed] ${label}: ${envVar} not set \u2014 generated password: ${gen}`);
  return gen;
};
const ADMIN_PW = seedPw("QM_ADMIN_PW", "admin");
const QM_PW = seedPw("QM_QUARTERMASTER_PW", "quartermaster");
const AUDITOR_PW = seedPw("QM_AUDITOR_PW", "auditor");
const daysFromNow = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

async function seed() {
  // Wipe (idempotent reseed). Deleted in FK-safe order; item_units/item_variants
  // are removed too so a reseed starts from a clean slate. `id >= 0` matches
  // every row (identity ids start at 1) — PostgREST requires a filter on delete.
  const wipe = async (table: string) => { unwrap(await supabase.from(table).delete().gte("id", 0)); };
  await wipe("assignments");
  await wipe("kit_items");
  await wipe("kits");
  await wipe("item_units");
  await wipe("item_variants");
  await wipe("items");
  await wipe("officers");
  await wipe("users");
  await wipe("audit_log");

  /* ---- Users ---- */
  await storage.createUser({ username: "admin", password: hash(ADMIN_PW), name: "System Administrator", role: "admin", mustChangePassword: false, active: true, officerId: null as any });
  await storage.createUser({ username: "quartermaster", password: hash(QM_PW), name: "Sgt. Dana Reyes", role: "quartermaster", mustChangePassword: false, active: true, officerId: null as any });
  await storage.createUser({ username: "auditor", password: hash(AUDITOR_PW), name: "Internal Audit", role: "auditor", mustChangePassword: false, active: true, officerId: null as any });

  /* ---- Officers ---- */
  const off = [];
  off.push(await storage.createOfficer({ badgeNumber: "1042", firstName: "Marcus", lastName: "Hale", rank: "Officer", unit: "Team 1 Days", email: "m.hale@ufpd.ufl.edu", phone: "352-555-0142", status: "active", hireDate: "2021-03-15", shirtSize: "L", pantsSize: "34x32", jacketSize: "L", shoeSize: "11", vestSize: "Medium", hatSize: "7 1/4", gloveSize: "L", notes: "" } as any));
  off.push(await storage.createOfficer({ badgeNumber: "1078", firstName: "Elena", lastName: "Vasquez", rank: "Detective", unit: "K-9, Investigations", email: "e.vasquez@ufpd.ufl.edu", phone: "352-555-0178", status: "active", hireDate: "2019-08-01", shirtSize: "M", pantsSize: "30x30", jacketSize: "M", shoeSize: "8.5", vestSize: "Small", hatSize: "7", gloveSize: "M", notes: "K-9 handler — Rex" } as any));
  off.push(await storage.createOfficer({ badgeNumber: "1003", firstName: "David", lastName: "Okafor", rank: "Sergeant", unit: "Team 2 Days", email: "d.okafor@ufpd.ufl.edu", phone: "352-555-0103", status: "active", hireDate: "2015-06-20", shirtSize: "XL", pantsSize: "38x32", jacketSize: "XL", shoeSize: "12", vestSize: "Large", hatSize: "7 3/8", gloveSize: "XL", notes: "Shift supervisor" } as any));
  off.push(await storage.createOfficer({ badgeNumber: "1101", firstName: "Sarah", lastName: "Chen", rank: "Officer", unit: "Community Services", email: "s.chen@ufpd.ufl.edu", phone: "352-555-0201", status: "active", hireDate: "2023-01-09", shirtSize: "S", pantsSize: "28x30", jacketSize: "S", shoeSize: "7", vestSize: "Small", hatSize: "6 7/8", gloveSize: "S", notes: "New hire — kit pending" } as any));
  off.push(await storage.createOfficer({ badgeNumber: "1055", firstName: "James", lastName: "Whitfield", rank: "Officer", unit: "Traffic, Patrol Rifle", email: "j.whitfield@ufpd.ufl.edu", phone: "352-555-0155", status: "active", hireDate: "2020-11-02", shirtSize: "L", pantsSize: "36x32", jacketSize: "L", shoeSize: "10.5", vestSize: "Medium", hatSize: "7 1/8", gloveSize: "L", notes: "" } as any));

  /* ---- Items ---- */
  const mk = (o: any) => storage.createItem(o);
  const it: any = {};
  it.vest = await mk({ name: "Ballistic Vest (Level IIIA)", category: "Body Armor", type: "unique", sku: "BA-3A-001", serialNumber: "VST-2024-001", size: "Medium", color: "Black", quantity: 1, parLevel: 0, location: "Armory", unitCost: 850, vendor: "Safariland", grantNumber: "BVP-2024", expirationDate: daysFromNow(45), condition: "New", status: "in_stock", requiresInspection: true, notes: "5-year armor warranty" });
  it.vest2 = await mk({ name: "Ballistic Vest (Level IIIA)", category: "Body Armor", type: "unique", sku: "BA-3A-002", serialNumber: "VST-2021-014", size: "Large", color: "Black", quantity: 1, parLevel: 0, location: "Armory", unitCost: 850, vendor: "Safariland", grantNumber: "BVP-2021", expirationDate: daysFromNow(-10), condition: "Good", status: "in_stock", requiresInspection: true, notes: "EXPIRED — replace" });
  it.taser = await mk({ name: "TASER 7 CEW", category: "Less-Lethal", type: "unique", sku: "TSR-7-008", serialNumber: "X7-558203", size: "", color: "Yellow/Black", quantity: 1, parLevel: 0, location: "Armory", unitCost: 1399, vendor: "Axon", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: true, notes: "" });
  it.radio = await mk({ name: "Motorola APX 6000 Radio", category: "Communications", type: "unique", sku: "RAD-APX-021", serialNumber: "APX-778120", size: "", color: "Black", quantity: 1, parLevel: 0, location: "Stock Room", unitCost: 2400, vendor: "Motorola", grantNumber: "", expirationDate: null, condition: "Good", status: "in_stock", requiresInspection: false, notes: "" });
  it.shirt = await mk({ name: "Uniform Shirt - Class B", category: "Uniform", type: "returnable", sku: "UNI-SHB", serialNumber: "", size: "L", color: "Navy", quantity: 24, parLevel: 10, location: "Stock Room", unitCost: 42, vendor: "Galls", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "" });
  it.pants = await mk({ name: "Tactical Pants", category: "Uniform", type: "returnable", sku: "UNI-PNT", serialNumber: "", size: "34x32", color: "Navy", quantity: 8, parLevel: 12, location: "Stock Room", unitCost: 55, vendor: "5.11 Tactical", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "Below PAR — reorder" });
  it.boots = await mk({ name: "Duty Boots", category: "Footwear", type: "returnable", sku: "FW-BOOT", serialNumber: "", size: "11", color: "Black", quantity: 6, parLevel: 6, location: "Stock Room", unitCost: 120, vendor: "Galls", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "" });
  it.gloves = await mk({ name: "Tactical Gloves", category: "PPE", type: "consumable", sku: "PPE-GLV", serialNumber: "", size: "L", color: "Black", quantity: 3, parLevel: 15, location: "DT Lab Storage", unitCost: 28, vendor: "Mechanix", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "Low stock" });
  it.cuffs = await mk({ name: "Handcuffs (Steel)", category: "Restraints", type: "returnable", sku: "RST-CUF", serialNumber: "", size: "Standard", color: "Nickel", quantity: 18, parLevel: 8, location: "Armory", unitCost: 32, vendor: "Smith & Wesson", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "" });
  it.flashlight = await mk({ name: "Streamlight Stinger", category: "Equipment", type: "returnable", sku: "EQ-FLSH", serialNumber: "", size: "", color: "Black", quantity: 14, parLevel: 6, location: "Stock Room", unitCost: 95, vendor: "Streamlight", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "" });
  it.firstaid = await mk({ name: "IFAK Trauma Kit", category: "Medical", type: "consumable", sku: "MED-IFAK", serialNumber: "", size: "", color: "Black", quantity: 9, parLevel: 5, location: "Stock Room", unitCost: 75, vendor: "North American Rescue", grantNumber: "", expirationDate: daysFromNow(75), condition: "New", status: "in_stock", requiresInspection: false, notes: "Tourniquet expires — check dates" });
  it.belt = await mk({ name: "Duty Belt (Nylon)", category: "Uniform", type: "returnable", sku: "UNI-BLT", serialNumber: "", size: "Medium", color: "Black", quantity: 11, parLevel: 6, location: "Stock Room", unitCost: 48, vendor: "5.11 Tactical", grantNumber: "", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "" });
  it.bodycam = await mk({ name: "Axon Body 3 Camera", category: "Equipment", type: "unique", sku: "EQ-BC3-014", serialNumber: "AB3-902117", size: "", color: "Black", quantity: 1, parLevel: 0, location: "Stock Room", unitCost: 699, vendor: "Axon", grantNumber: "BWC-2023", expirationDate: null, condition: "New", status: "in_stock", requiresInspection: false, notes: "" });

  /* ---- Active assignments (incl. overdue) ---- */
  const issue = async (item: any, officer: any, qty: number, dueDate: string | null, issuedAt: string) => {
    await storage.updateItem(item.id, { quantity: item.quantity - qty, status: item.type === "unique" ? "issued" : item.status });
    item.quantity -= qty;
    return storage.createAssignment({ itemId: item.id, officerId: officer.id, quantity: qty, status: "active", conditionOut: "New", conditionIn: null as any, issuedAt, dueDate: dueDate as any, returnedAt: null as any, issuedBy: "Sgt. Dana Reyes", returnedBy: null as any, signature: `${officer.firstName} ${officer.lastName}`, notes: null as any });
  };
  await issue(it.radio, off[0], 1, null, daysFromNow(-30));
  await issue(it.shirt, off[0], 3, null, daysFromNow(-30));
  await issue(it.flashlight, off[1], 1, daysFromNow(-5), daysFromNow(-40)); // OVERDUE
  await issue(it.taser, off[2], 1, null, daysFromNow(-60));
  await issue(it.bodycam, off[4], 1, daysFromNow(20), daysFromNow(-15));
  await issue(it.cuffs, off[4], 1, null, daysFromNow(-15));

  /* ---- Kits ---- */
  const patrolKit = await storage.createKit({ name: "New Patrol Officer Standard Issue", description: "Standard equipment set for newly hired patrol officers." });
  for (const [item, qty] of [[it.shirt, 3], [it.pants, 2], [it.boots, 1], [it.belt, 1], [it.cuffs, 1], [it.flashlight, 1], [it.firstaid, 1]] as [any, number][]) {
    await storage.createKitItem({ kitId: patrolKit.id, itemId: item.id, quantity: qty });
  }
  const fieldKit = await storage.createKit({ name: "Field Training Kit", description: "Temporary loadout for field training assignments." });
  for (const [item, qty] of [[it.flashlight, 1], [it.cuffs, 1], [it.gloves, 1]] as [any, number][]) {
    await storage.createKitItem({ kitId: fieldKit.id, itemId: item.id, quantity: qty });
  }

  await storage.addAudit({ action: "seed", entity: "system", entityId: null as any, detail: "Database seeded with sample UFPD data", username: "system", timestamp: nowISO() });
  console.log("Seed complete.");
}

seed().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
