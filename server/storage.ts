import {
  users, officers, items, assignments, kits, kitItems, auditLog, itemUnits,
} from "@shared/schema";
import type {
  User, InsertUser, Officer, InsertOfficer, Item, InsertItem,
  Assignment, InsertAssignment, Kit, InsertKit, KitItem, InsertKitItem,
  AuditEntry, InsertAudit, ItemUnit, InsertItemUnit,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
// SQLCipher-capable, API-compatible drop-in replacement for better-sqlite3.
import Database from "better-sqlite3-multiple-ciphers";
import { eq, desc, and } from "drizzle-orm";

/* ----------------------- Encryption at rest -----------------------
 * The SQLite database file is encrypted on disk with SQLCipher (AES-256).
 * The key is supplied at runtime via the DB_ENCRYPTION_KEY environment
 * variable, so it is never written into source control or into the database
 * file itself. In a UFIT / RC PubApps deployment this value is provided by
 * the host's protected environment or secret store. The development default
 * below is clearly marked and MUST be overridden before any real data is
 * stored.
 * ------------------------------------------------------------------ */
const DEV_DEFAULT_KEY = "dev-insecure-key-change-me";
const ENV_KEY = process.env.DB_ENCRYPTION_KEY;
if (!ENV_KEY && process.env.NODE_ENV === "production") {
  // Fail fast in production: refuse to start with the insecure dev key, which
  // would silently store real departmental data under a publicly known key.
  throw new Error(
    "[security] DB_ENCRYPTION_KEY must be set in production. Refusing to start " +
    "with the insecure development key. Provide DB_ENCRYPTION_KEY via the host's " +
    "protected environment or secret store.",
  );
}
const DB_KEY = ENV_KEY || DEV_DEFAULT_KEY;
if (DB_KEY === DEV_DEFAULT_KEY) {
  console.warn(
    "[security] DB_ENCRYPTION_KEY is not set \u2014 using the insecure development " +
    "key. Set DB_ENCRYPTION_KEY before storing real departmental data.",
  );
}

const sqlite = new Database("data.db");
// Select the SQLCipher cipher and apply the key BEFORE any other statement.
sqlite.pragma("cipher='sqlcipher'");
sqlite.pragma(`key='${DB_KEY.replace(/'/g, "''")}'`);
sqlite.pragma("journal_mode = WAL");

// Self-initialize the schema (idempotent) so a fresh encrypted database can be
// created without drizzle-kit push, which cannot open an encrypted file.
sqlite.exec(`
CREATE TABLE IF NOT EXISTS "users" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "username" text NOT NULL,
  "password" text NOT NULL,
  "name" text NOT NULL,
  "role" text DEFAULT 'officer' NOT NULL,
  "officer_id" integer,
  "must_change_password" integer DEFAULT false NOT NULL,
  "active" integer DEFAULT true NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_unique" ON "users" ("username");
CREATE TABLE IF NOT EXISTS "officers" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "badge_number" text NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text NOT NULL,
  "rank" text,
  "unit" text,
  "email" text,
  "phone" text,
  "status" text DEFAULT 'active' NOT NULL,
  "hire_date" text,
  "shirt_size" text,
  "pants_size" text,
  "jacket_size" text,
  "shoe_size" text,
  "vest_size" text,
  "hat_size" text,
  "glove_size" text,
  "notes" text
);
CREATE TABLE IF NOT EXISTS "items" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "name" text NOT NULL,
  "category" text DEFAULT 'General' NOT NULL,
  "type" text DEFAULT 'consumable' NOT NULL,
  "sku" text,
  "serial_number" text,
  "size" text,
  "color" text,
  "quantity" integer DEFAULT 0 NOT NULL,
  "par_level" integer DEFAULT 0 NOT NULL,
  "location" text,
  "unit_cost" real DEFAULT 0,
  "vendor" text,
  "grant_number" text,
  "expiration_date" text,
  "condition" text DEFAULT 'New',
  "status" text DEFAULT 'in_stock' NOT NULL,
  "requires_inspection" integer DEFAULT false NOT NULL,
  "last_inspected" text,
  "image_url" text,
  "notes" text,
  "created_at" text NOT NULL,
  "subcategory" text,
  "attributes" text
);
CREATE TABLE IF NOT EXISTS "kits" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "name" text NOT NULL,
  "description" text
);
CREATE TABLE IF NOT EXISTS "kit_items" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "kit_id" integer NOT NULL,
  "item_id" integer NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL
);
CREATE TABLE IF NOT EXISTS "assignments" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "item_id" integer NOT NULL,
  "officer_id" integer NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "condition_out" text DEFAULT 'New',
  "condition_in" text,
  "issued_at" text NOT NULL,
  "due_date" text,
  "returned_at" text,
  "issued_by" text,
  "returned_by" text,
  "signature" text,
  "notes" text
);
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "action" text NOT NULL,
  "entity" text,
  "entity_id" integer,
  "detail" text,
  "username" text,
  "timestamp" text NOT NULL
);
CREATE TABLE IF NOT EXISTS "item_units" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "item_id" integer NOT NULL,
  "serial_number" text NOT NULL,
  "secondary_serial_number" text,
  "status" text DEFAULT 'in_stock' NOT NULL,
  "condition" text DEFAULT 'New',
  "assigned_officer_id" integer,
  "location" text,
  "acquired_date" text,
  "notes" text,
  "created_at" text NOT NULL
);
`);

/* ----------------------- Additive migrations ----------------------
 * drizzle-kit push cannot open the encrypted database, so schema changes that
 * ALTER existing tables are applied here at startup. Each helper is idempotent:
 * it checks the live column set first and only adds what is missing. Migrations
 * must be ADDITIVE ONLY so an existing (snapshotted-forward) data.db keeps all
 * of its rows.
 * ------------------------------------------------------------------ */
function addColumnIfMissing(table: string, column: string, definition: string) {
  const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN ${definition}`);
  }
}

// assignments.item_unit_id links an assignment to a specific serialized unit.
addColumnIfMissing("assignments", "item_unit_id", '"item_unit_id" integer');
// Safety net in case an older item_units table predates the secondary serial.
addColumnIfMissing("item_units", "secondary_serial_number", '"secondary_serial_number" text');

export const db = drizzle(sqlite);

const now = () => new Date().toISOString();

export type UnitStatusCounts = {
  total: number;
  in_stock: number;
  issued: number;
  maintenance: number;
  retired: number;
};

export interface IStorage {
  // users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  createUser(u: InsertUser): Promise<User>;
  updateUser(id: number, u: Partial<InsertUser>): Promise<User | undefined>;
  deleteUser(id: number): Promise<void>;
  // officers
  listOfficers(): Promise<Officer[]>;
  getOfficer(id: number): Promise<Officer | undefined>;
  createOfficer(o: InsertOfficer): Promise<Officer>;
  updateOfficer(id: number, o: Partial<InsertOfficer>): Promise<Officer | undefined>;
  deleteOfficer(id: number): Promise<void>;
  // items
  listItems(): Promise<Item[]>;
  getItem(id: number): Promise<Item | undefined>;
  createItem(i: InsertItem): Promise<Item>;
  updateItem(id: number, i: Partial<InsertItem>): Promise<Item | undefined>;
  deleteItem(id: number): Promise<void>;
  // item units (serialized)
  listUnitsByItem(itemId: number): Promise<ItemUnit[]>;
  getUnit(id: number): Promise<ItemUnit | undefined>;
  createUnit(u: Omit<InsertItemUnit, "status" | "assignedOfficerId">): Promise<ItemUnit>;
  updateUnit(id: number, patch: Partial<InsertItemUnit>): Promise<ItemUnit | undefined>;
  deleteUnit(id: number): Promise<void>;
  unitStatusCountsByItem(): Promise<Record<number, UnitStatusCounts>>;
  syncItemQuantity(itemId: number): Promise<void>;
  // assignments
  listAssignments(): Promise<Assignment[]>;
  listActiveAssignments(): Promise<Assignment[]>;
  getAssignment(id: number): Promise<Assignment | undefined>;
  createAssignment(a: InsertAssignment): Promise<Assignment>;
  updateAssignment(id: number, a: Partial<InsertAssignment>): Promise<Assignment | undefined>;
  // kits
  listKits(): Promise<Kit[]>;
  createKit(k: InsertKit): Promise<Kit>;
  deleteKit(id: number): Promise<void>;
  listKitItems(kitId: number): Promise<KitItem[]>;
  createKitItem(ki: InsertKitItem): Promise<KitItem>;
  deleteKitItem(id: number): Promise<void>;
  // audit
  listAudit(limit?: number): Promise<AuditEntry[]>;
  addAudit(a: InsertAudit): Promise<AuditEntry>;
}

export class DatabaseStorage implements IStorage {
  // ---- users ----
  async getUser(id: number) {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  async getUserByUsername(username: string) {
    return db.select().from(users).where(eq(users.username, username)).get();
  }
  async listUsers() {
    return db.select().from(users).all();
  }
  async createUser(u: InsertUser) {
    return db.insert(users).values(u).returning().get();
  }
  async updateUser(id: number, u: Partial<InsertUser>) {
    return db.update(users).set(u).where(eq(users.id, id)).returning().get();
  }
  async deleteUser(id: number) {
    db.delete(users).where(eq(users.id, id)).run();
  }

  // ---- officers ----
  async listOfficers() {
    return db.select().from(officers).orderBy(officers.lastName).all();
  }
  async getOfficer(id: number) {
    return db.select().from(officers).where(eq(officers.id, id)).get();
  }
  async createOfficer(o: InsertOfficer) {
    return db.insert(officers).values(o).returning().get();
  }
  async updateOfficer(id: number, o: Partial<InsertOfficer>) {
    return db.update(officers).set(o).where(eq(officers.id, id)).returning().get();
  }
  async deleteOfficer(id: number) {
    db.delete(officers).where(eq(officers.id, id)).run();
  }

  // ---- items ----
  async listItems() {
    return db.select().from(items).orderBy(items.name).all();
  }
  async getItem(id: number) {
    return db.select().from(items).where(eq(items.id, id)).get();
  }
  async createItem(i: InsertItem) {
    return db.insert(items).values({ ...i, createdAt: now() }).returning().get();
  }
  async updateItem(id: number, i: Partial<InsertItem>) {
    return db.update(items).set(i).where(eq(items.id, id)).returning().get();
  }
  async deleteItem(id: number) {
    db.delete(items).where(eq(items.id, id)).run();
  }

  // ---- item units (serialized) ----
  async listUnitsByItem(itemId: number) {
    return db.select().from(itemUnits).where(eq(itemUnits.itemId, itemId)).orderBy(itemUnits.id).all();
  }
  async getUnit(id: number) {
    return db.select().from(itemUnits).where(eq(itemUnits.id, id)).get();
  }
  async createUnit(u: Omit<InsertItemUnit, "status" | "assignedOfficerId">) {
    const unit = db.insert(itemUnits).values({
      ...u,
      status: "in_stock",
      assignedOfficerId: null,
      createdAt: now(),
    }).returning().get();
    await this.syncItemQuantity(unit.itemId);
    return unit;
  }
  async updateUnit(id: number, patch: Partial<InsertItemUnit>) {
    const updated = db.update(itemUnits).set(patch).where(eq(itemUnits.id, id)).returning().get();
    if (updated) await this.syncItemQuantity(updated.itemId);
    return updated;
  }
  async deleteUnit(id: number) {
    const unit = await this.getUnit(id);
    db.delete(itemUnits).where(eq(itemUnits.id, id)).run();
    if (unit) await this.syncItemQuantity(unit.itemId);
  }
  async unitStatusCountsByItem() {
    const out: Record<number, UnitStatusCounts> = {};
    const all = db.select().from(itemUnits).all();
    for (const u of all) {
      const c = out[u.itemId] ?? (out[u.itemId] = { total: 0, in_stock: 0, issued: 0, maintenance: 0, retired: 0 });
      c.total++;
      if (u.status === "in_stock" || u.status === "issued" || u.status === "maintenance" || u.status === "retired") {
        c[u.status]++;
      }
    }
    return out;
  }
  // Keep the parent item's quantity/status in sync with its serialized units:
  // quantity = number of units; status = 'issued' only when NO unit is in_stock
  // (otherwise 'in_stock'), so the catalog still reflects availability at a glance.
  async syncItemQuantity(itemId: number) {
    const item = await this.getItem(itemId);
    if (!item || item.type !== "unique") return;
    const units = await this.listUnitsByItem(itemId);
    const inStock = units.filter((u) => u.status === "in_stock").length;
    const patch: Partial<InsertItem> = { quantity: units.length };
    // Don't clobber a manual maintenance/retired hold on the item itself.
    if (item.status === "in_stock" || item.status === "issued") {
      patch.status = inStock > 0 ? "in_stock" : "issued";
    }
    db.update(items).set(patch).where(eq(items.id, itemId)).run();
  }

  // ---- assignments ----
  async listAssignments() {
    return db.select().from(assignments).orderBy(desc(assignments.issuedAt)).all();
  }
  async listActiveAssignments() {
    return db.select().from(assignments).where(eq(assignments.status, "active")).all();
  }
  async getAssignment(id: number) {
    return db.select().from(assignments).where(eq(assignments.id, id)).get();
  }
  async createAssignment(a: InsertAssignment) {
    return db.insert(assignments).values(a).returning().get();
  }
  async updateAssignment(id: number, a: Partial<InsertAssignment>) {
    return db.update(assignments).set(a).where(eq(assignments.id, id)).returning().get();
  }

  // ---- kits ----
  async listKits() {
    return db.select().from(kits).all();
  }
  async createKit(k: InsertKit) {
    return db.insert(kits).values(k).returning().get();
  }
  async deleteKit(id: number) {
    db.delete(kitItems).where(eq(kitItems.kitId, id)).run();
    db.delete(kits).where(eq(kits.id, id)).run();
  }
  async listKitItems(kitId: number) {
    return db.select().from(kitItems).where(eq(kitItems.kitId, kitId)).all();
  }
  async createKitItem(ki: InsertKitItem) {
    return db.insert(kitItems).values(ki).returning().get();
  }
  async deleteKitItem(id: number) {
    db.delete(kitItems).where(eq(kitItems.id, id)).run();
  }

  // ---- audit ----
  async listAudit(limit = 200) {
    return db.select().from(auditLog).orderBy(desc(auditLog.timestamp)).limit(limit).all();
  }
  async addAudit(a: InsertAudit) {
    return db.insert(auditLog).values(a).returning().get();
  }
}

export const storage = new DatabaseStorage();
