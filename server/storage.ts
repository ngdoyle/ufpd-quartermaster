import type {
  User, InsertUser, Officer, InsertOfficer, Item, InsertItem,
  Assignment, InsertAssignment, Kit, InsertKit, KitItem, InsertKitItem,
  AuditEntry, InsertAudit, ItemUnit, InsertItemUnit, ItemVariant, InsertItemVariant,
  VariantCounts,
} from "@shared/schema";
import { supabase, unwrap } from "./supabase";

/* ------------------------------------------------------------------ *
 * Storage layer — Supabase (Postgres) via @supabase/supabase-js.
 *
 * Single-table CRUD uses PostgREST directly. Every multi-write /
 * transactional operation (issue, batch issue, kit issue, return, kit-item
 * replace, serialized-unit quantity sync) is delegated to a plpgsql function
 * (see supabase/migration.sql) via supabase.rpc() so it runs atomically.
 *
 * Postgres columns are quoted camelCase, matching the TS field names, so rows
 * round-trip with no key mapping and JSON responses stay byte-identical to the
 * previous SQLite/Drizzle implementation.
 * ------------------------------------------------------------------ */

const now = () => new Date().toISOString();

// PostgREST table names (snake_case) — column names remain camelCase.
const T = {
  users: "users",
  officers: "officers",
  items: "items",
  itemUnits: "item_units",
  itemVariants: "item_variants",
  assignments: "assignments",
  kits: "kits",
  kitItems: "kit_items",
  auditLog: "audit_log",
} as const;

export type UnitStatusCounts = {
  total: number;
  in_stock: number;
  issued: number;
  maintenance: number;
  retired: number;
};

// Pre-resolved, aggregated writes for an all-or-nothing multi-line issue.
// Stock deltas are pre-computed final values (one per distinct target), so the
// RPC just applies them; one assignment row is inserted per issue line.
export interface IssueBatchPlan {
  variantDeltas: { id: number; newQty: number }[];
  itemDeltas: { id: number; newQty: number; setIssued: boolean }[];
  unitIssues: { id: number; officerId: number }[];
  assignments: InsertAssignment[];
}

// Kit issue reuses the aggregated-delta shape and additionally re-derives the
// affected serialized items' quantity/status (syncItemIds) — matching the old
// per-unit storage.updateUnit -> syncItemQuantity behavior.
export interface KitIssuePlan extends IssueBatchPlan {
  syncItemIds: number[];
}

// Pre-resolved patches for an atomic return + restock.
export interface ReturnPlan {
  assignmentId: number;
  assignmentPatch: {
    status: string;
    conditionIn: string;
    returnedAt: string;
    returnedBy: string | null;
    notes: string | null;
  };
  variantDelta: { id: number; newQty: number } | null;
  unitPatch: { id: number; status: string; assignedOfficerId: number | null; condition: string } | null;
  itemPatch: { id: number; quantity: number; status: string; condition: string } | null;
  syncItemIds: number[];
}

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
  // item variants (sized)
  listVariants(itemId: number): Promise<ItemVariant[]>;
  getVariant(id: number): Promise<ItemVariant | undefined>;
  createVariant(v: InsertItemVariant): Promise<ItemVariant>;
  updateVariant(id: number, patch: Partial<InsertItemVariant>): Promise<ItemVariant | undefined>;
  deleteVariant(id: number): Promise<void>;
  variantCountsByItem(): Promise<Record<number, VariantCounts>>;
  // assignments
  listAssignments(): Promise<Assignment[]>;
  listActiveAssignments(): Promise<Assignment[]>;
  getAssignment(id: number): Promise<Assignment | undefined>;
  listAssignmentsByOfficer(officerId: number): Promise<Assignment[]>;
  createAssignment(a: InsertAssignment): Promise<Assignment>;
  issueBatch(plan: IssueBatchPlan): Promise<Assignment[]>;
  issueKit(plan: KitIssuePlan): Promise<Assignment[]>;
  returnAssignment(plan: ReturnPlan): Promise<Assignment | undefined>;
  updateAssignment(id: number, a: Partial<InsertAssignment>): Promise<Assignment | undefined>;
  deleteAssignmentsByOfficer(officerId: number): Promise<void>;
  // kits
  listKits(): Promise<Kit[]>;
  getKit(id: number): Promise<Kit | undefined>;
  createKit(k: InsertKit): Promise<Kit>;
  updateKit(id: number, k: Partial<InsertKit>): Promise<Kit | undefined>;
  deleteKit(id: number): Promise<void>;
  listKitItems(kitId: number): Promise<KitItem[]>;
  createKitItem(ki: InsertKitItem): Promise<KitItem>;
  deleteKitItem(id: number): Promise<void>;
  replaceKitItems(kitId: number, lines: { itemId: number; quantity: number }[]): Promise<void>;
  // audit
  listAudit(limit?: number): Promise<AuditEntry[]>;
  addAudit(a: InsertAudit): Promise<AuditEntry>;
}

export class DatabaseStorage implements IStorage {
  // ---- users ----
  async getUser(id: number) {
    return unwrap(await supabase.from(T.users).select("*").eq("id", id).maybeSingle()) as User ?? undefined;
  }
  async getUserByUsername(username: string) {
    return unwrap(await supabase.from(T.users).select("*").eq("username", username).maybeSingle()) as User ?? undefined;
  }
  async listUsers() {
    return unwrap(await supabase.from(T.users).select("*")) as User[];
  }
  async createUser(u: InsertUser) {
    return unwrap(await supabase.from(T.users).insert(u).select().single()) as User;
  }
  async updateUser(id: number, u: Partial<InsertUser>) {
    return unwrap(await supabase.from(T.users).update(u).eq("id", id).select().maybeSingle()) as User ?? undefined;
  }
  async deleteUser(id: number) {
    unwrap(await supabase.from(T.users).delete().eq("id", id));
  }

  // ---- officers ----
  async listOfficers() {
    return unwrap(await supabase.from(T.officers).select("*").order("lastName")) as Officer[];
  }
  async getOfficer(id: number) {
    return unwrap(await supabase.from(T.officers).select("*").eq("id", id).maybeSingle()) as Officer ?? undefined;
  }
  async createOfficer(o: InsertOfficer) {
    return unwrap(await supabase.from(T.officers).insert(o).select().single()) as Officer;
  }
  async updateOfficer(id: number, o: Partial<InsertOfficer>) {
    return unwrap(await supabase.from(T.officers).update(o).eq("id", id).select().maybeSingle()) as Officer ?? undefined;
  }
  async deleteOfficer(id: number) {
    unwrap(await supabase.from(T.officers).delete().eq("id", id));
  }

  // ---- items ----
  async listItems() {
    return unwrap(await supabase.from(T.items).select("*").order("name")) as Item[];
  }
  async getItem(id: number) {
    return unwrap(await supabase.from(T.items).select("*").eq("id", id).maybeSingle()) as Item ?? undefined;
  }
  async createItem(i: InsertItem) {
    return unwrap(await supabase.from(T.items).insert({ ...i, createdAt: now() }).select().single()) as Item;
  }
  async updateItem(id: number, i: Partial<InsertItem>) {
    return unwrap(await supabase.from(T.items).update(i).eq("id", id).select().maybeSingle()) as Item ?? undefined;
  }
  async deleteItem(id: number) {
    // FK ON DELETE CASCADE removes this item's units, variants, assignments,
    // and kit-item lines in the same statement (see migration.sql).
    unwrap(await supabase.from(T.items).delete().eq("id", id));
  }

  // ---- item units (serialized) ----
  async listUnitsByItem(itemId: number) {
    return unwrap(await supabase.from(T.itemUnits).select("*").eq("itemId", itemId).order("id")) as ItemUnit[];
  }
  async getUnit(id: number) {
    return unwrap(await supabase.from(T.itemUnits).select("*").eq("id", id).maybeSingle()) as ItemUnit ?? undefined;
  }
  async createUnit(u: Omit<InsertItemUnit, "status" | "assignedOfficerId">) {
    const unit = unwrap(await supabase.from(T.itemUnits).insert({
      ...u,
      status: "in_stock",
      assignedOfficerId: null,
      createdAt: now(),
    }).select().single()) as ItemUnit;
    await this.syncItemQuantity(unit.itemId);
    return unit;
  }
  async updateUnit(id: number, patch: Partial<InsertItemUnit>) {
    const updated = unwrap(await supabase.from(T.itemUnits).update(patch).eq("id", id).select().maybeSingle()) as ItemUnit ?? undefined;
    if (updated) await this.syncItemQuantity(updated.itemId);
    return updated;
  }
  async deleteUnit(id: number) {
    const unit = await this.getUnit(id);
    unwrap(await supabase.from(T.itemUnits).delete().eq("id", id));
    if (unit) await this.syncItemQuantity(unit.itemId);
  }
  async unitStatusCountsByItem() {
    const out: Record<number, UnitStatusCounts> = {};
    const all = unwrap(await supabase.from(T.itemUnits).select("itemId,status")) as { itemId: number; status: string }[];
    for (const u of all) {
      const c = out[u.itemId] ?? (out[u.itemId] = { total: 0, in_stock: 0, issued: 0, maintenance: 0, retired: 0 });
      c.total++;
      if (u.status === "in_stock" || u.status === "issued" || u.status === "maintenance" || u.status === "retired") {
        c[u.status]++;
      }
    }
    return out;
  }
  // Re-derive a `unique` item's quantity/status from its units (atomic in the
  // DB). See sync_item_quantity() in migration.sql.
  async syncItemQuantity(itemId: number) {
    unwrap(await supabase.rpc("sync_item_quantity", { p_item_id: itemId }));
  }

  // ---- item variants (sized) ----
  async listVariants(itemId: number) {
    return unwrap(await supabase.from(T.itemVariants).select("*").eq("itemId", itemId).order("id")) as ItemVariant[];
  }
  async getVariant(id: number) {
    return unwrap(await supabase.from(T.itemVariants).select("*").eq("id", id).maybeSingle()) as ItemVariant ?? undefined;
  }
  async createVariant(v: InsertItemVariant) {
    return unwrap(await supabase.from(T.itemVariants).insert({ ...v, createdAt: now() }).select().single()) as ItemVariant;
  }
  async updateVariant(id: number, patch: Partial<InsertItemVariant>) {
    return unwrap(await supabase.from(T.itemVariants).update(patch).eq("id", id).select().maybeSingle()) as ItemVariant ?? undefined;
  }
  async deleteVariant(id: number) {
    unwrap(await supabase.from(T.itemVariants).delete().eq("id", id));
  }
  async variantCountsByItem() {
    const out: Record<number, VariantCounts> = {};
    const all = unwrap(await supabase.from(T.itemVariants).select("*").order("id")) as ItemVariant[];
    for (const v of all) {
      const c = out[v.itemId] ?? (out[v.itemId] = { total: 0, sizes: [] });
      c.total += v.quantity;
      c.sizes.push({ id: v.id, size: v.size, quantity: v.quantity, parLevel: v.parLevel });
    }
    return out;
  }

  // ---- assignments ----
  async listAssignments() {
    return unwrap(await supabase.from(T.assignments).select("*").order("issuedAt", { ascending: false })) as Assignment[];
  }
  async listActiveAssignments() {
    return unwrap(await supabase.from(T.assignments).select("*").eq("status", "active")) as Assignment[];
  }
  async getAssignment(id: number) {
    return unwrap(await supabase.from(T.assignments).select("*").eq("id", id).maybeSingle()) as Assignment ?? undefined;
  }
  async listAssignmentsByOfficer(officerId: number) {
    return unwrap(await supabase.from(T.assignments).select("*").eq("officerId", officerId)) as Assignment[];
  }
  async createAssignment(a: InsertAssignment) {
    return unwrap(await supabase.from(T.assignments).insert(a).select().single()) as Assignment;
  }
  // Apply a pre-validated batch of issues atomically (all stock decrements and
  // assignment inserts land together or not at all).
  async issueBatch(plan: IssueBatchPlan) {
    return unwrap(await supabase.rpc("issue_batch", { p: plan })) as Assignment[];
  }
  async issueKit(plan: KitIssuePlan) {
    return unwrap(await supabase.rpc("kit_issue", { p: plan })) as Assignment[];
  }
  async returnAssignment(plan: ReturnPlan) {
    return unwrap(await supabase.rpc("return_assignment", { p: plan })) as Assignment ?? undefined;
  }
  async updateAssignment(id: number, a: Partial<InsertAssignment>) {
    return unwrap(await supabase.from(T.assignments).update(a).eq("id", id).select().maybeSingle()) as Assignment ?? undefined;
  }
  async deleteAssignmentsByOfficer(officerId: number) {
    unwrap(await supabase.from(T.assignments).delete().eq("officerId", officerId));
  }

  // ---- kits ----
  async listKits() {
    return unwrap(await supabase.from(T.kits).select("*")) as Kit[];
  }
  async getKit(id: number) {
    return unwrap(await supabase.from(T.kits).select("*").eq("id", id).maybeSingle()) as Kit ?? undefined;
  }
  async createKit(k: InsertKit) {
    return unwrap(await supabase.from(T.kits).insert(k).select().single()) as Kit;
  }
  async updateKit(id: number, k: Partial<InsertKit>) {
    return unwrap(await supabase.from(T.kits).update(k).eq("id", id).select().maybeSingle()) as Kit ?? undefined;
  }
  async deleteKit(id: number) {
    // FK ON DELETE CASCADE removes this kit's kit_items in the same statement.
    unwrap(await supabase.from(T.kits).delete().eq("id", id));
  }
  async replaceKitItems(kitId: number, lines: { itemId: number; quantity: number }[]) {
    unwrap(await supabase.rpc("replace_kit_items", { p: { kitId, lines } }));
  }
  async listKitItems(kitId: number) {
    return unwrap(await supabase.from(T.kitItems).select("*").eq("kitId", kitId)) as KitItem[];
  }
  async createKitItem(ki: InsertKitItem) {
    return unwrap(await supabase.from(T.kitItems).insert(ki).select().single()) as KitItem;
  }
  async deleteKitItem(id: number) {
    unwrap(await supabase.from(T.kitItems).delete().eq("id", id));
  }

  // ---- audit ----
  async listAudit(limit = 200) {
    return unwrap(await supabase.from(T.auditLog).select("*").order("timestamp", { ascending: false }).limit(limit)) as AuditEntry[];
  }
  async addAudit(a: InsertAudit) {
    return unwrap(await supabase.from(T.auditLog).insert(a).select().single()) as AuditEntry;
  }
}

export const storage = new DatabaseStorage();
