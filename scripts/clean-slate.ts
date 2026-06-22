/**
 * clean-slate.ts — Remove all operational data, keep user accounts.
 *
 * Wipes officers, items, assignments, kits, and the audit log so the app
 * starts empty — ready for real inventory entry. User accounts (and their
 * hardened passwords) are PRESERVED so you can still log in.
 *
 * USAGE
 *   DB_ENCRYPTION_KEY=$(cat .qm_db_key) npx tsx scripts/clean-slate.ts
 *
 * Run from the project root. Back up data.db first if you want a restore point.
 */
import { db, storage } from "../server/storage";
import { assignments, kitItems, kits, items, officers, auditLog } from "../shared/schema";

const before = {
  officers: db.select().from(officers).all().length,
  items: db.select().from(items).all().length,
  assignments: db.select().from(assignments).all().length,
  kits: db.select().from(kits).all().length,
};

db.delete(assignments).run();
db.delete(kitItems).run();
db.delete(kits).run();
db.delete(items).run();
db.delete(officers).run();
db.delete(auditLog).run();

// Record a fresh audit entry marking the clean start.
await storage.addAudit({
  action: "clean_slate",
  entity: "system",
  entityId: null as any,
  detail: "All operational data cleared; ready for production data entry. User accounts preserved.",
  username: "system",
  timestamp: new Date().toISOString(),
});

console.log("Cleared (rows removed):", JSON.stringify(before));
console.log("Users preserved:", db.select().from((await import("../shared/schema")).users).all().length);
console.log("Clean slate complete.");
