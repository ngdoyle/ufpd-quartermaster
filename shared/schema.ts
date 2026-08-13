import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Users — login accounts with role-based access                       */
/* ------------------------------------------------------------------ */
// Roles: admin | quartermaster | auditor
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("auditor"),
  // optional contact email — used for admin password resets (Batch 5)
  email: text("email"),
  // optional link to a personnel record (retained for historical account linkage)
  officerId: integer("officer_id"),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

/* ------------------------------------------------------------------ */
/* Officers — personnel profiles incl. uniform sizing (first-class)    */
/* ------------------------------------------------------------------ */
export const officers = sqliteTable("officers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  badgeNumber: text("badge_number").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  rank: text("rank"),
  unit: text("unit"),
  email: text("email"),
  phone: text("phone"),
  status: text("status").notNull().default("active"), // active | inactive
  type: text("type").notNull().default("person"), // person | business
  hireDate: text("hire_date"),
  // Uniform / gear sizing — first-class fields
  shirtSize: text("shirt_size"),
  pantsSize: text("pants_size"),
  jacketSize: text("jacket_size"),
  shoeSize: text("shoe_size"),
  vestSize: text("vest_size"),
  hatSize: text("hat_size"),
  gloveSize: text("glove_size"),
  notes: text("notes"),
});

export const insertOfficerSchema = createInsertSchema(officers).omit({ id: true });
export type InsertOfficer = z.infer<typeof insertOfficerSchema>;
export type Officer = typeof officers.$inferSelect;

/* ------------------------------------------------------------------ */
/* Items — inventory catalog                                           */
/* ------------------------------------------------------------------ */
// type: consumable (decrements, not returned) | returnable (bulk, returned) | unique (serialized, qty 1) | sized (clothing tracked per size via item_variants)
// status: in_stock | issued | maintenance | retired
export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  subcategory: text("subcategory"),
  type: text("type").notNull().default("consumable"),
  sku: text("sku"),
  serialNumber: text("serial_number"),
  size: text("size"),
  color: text("color"),
  quantity: integer("quantity").notNull().default(0),
  parLevel: integer("par_level").notNull().default(0),
  location: text("location"),
  unitCost: real("unit_cost").default(0),
  vendor: text("vendor"),
  grantNumber: text("grant_number"),
  expirationDate: text("expiration_date"),
  condition: text("condition").default("NEW"),
  status: text("status").notNull().default("in_stock"),
  // For `sized` items: whether issued sizes are restocked on return.
  // "returnable" (default) restocks the variant; "consumable" does not.
  returnBehavior: text("return_behavior").default("returnable"),
  // inspection gating
  requiresInspection: integer("requires_inspection", { mode: "boolean" }).notNull().default(false),
  // Dual serials (FP/BP) — for ballistic vests: requires both a primary
  // (front-panel) and secondary (back-panel) serial on each serialized unit.
  requiresDualSerial: integer("requires_dual_serial", { mode: "boolean" }).notNull().default(false),
  lastInspected: text("last_inspected"),
  imageUrl: text("image_url"),
  // JSON string of category/subcategory-specific dynamic fields (Make, Model, Caliber, etc.)
  attributes: text("attributes"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const insertItemSchema = createInsertSchema(items).omit({ id: true, createdAt: true });
export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;

/* ------------------------------------------------------------------ */
/* Item units — per-unit serialized tracking for `unique` items        */
/* ------------------------------------------------------------------ */
// One row per physical serialized unit of a `unique` item. status mirrors the
// item status vocabulary: in_stock | issued | maintenance | retired.
// secondarySerialNumber carries the second panel serial for ballistic vests.
export const itemUnits = sqliteTable("item_units", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull(),
  serialNumber: text("serial_number").notNull(),
  secondarySerialNumber: text("secondary_serial_number"),
  status: text("status").notNull().default("in_stock"),
  condition: text("condition").default("NEW"),
  assignedOfficerId: integer("assigned_officer_id"),
  location: text("location"),
  acquiredDate: text("acquired_date"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const insertItemUnitSchema = createInsertSchema(itemUnits).omit({ id: true, createdAt: true });
export type InsertItemUnit = z.infer<typeof insertItemUnitSchema>;
export type ItemUnit = typeof itemUnits.$inferSelect;

/* ------------------------------------------------------------------ */
/* Item variants — per-size stock for `sized` (clothing) items         */
/* ------------------------------------------------------------------ */
// One row per size of a `sized` item (e.g. "S", "M", "34x32"). Stock lives
// on the variant, not the parent item; the item's onHand is the sum of its
// variant quantities. parLevel is an optional per-size reorder threshold.
export const itemVariants = sqliteTable("item_variants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull(),
  size: text("size").notNull(),
  sku: text("sku"),
  quantity: integer("quantity").notNull().default(0),
  parLevel: integer("par_level").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const insertItemVariantSchema = createInsertSchema(itemVariants).omit({ id: true, createdAt: true });
export type InsertItemVariant = z.infer<typeof insertItemVariantSchema>;
export type ItemVariant = typeof itemVariants.$inferSelect;

/* ------------------------------------------------------------------ */
/* Stock computation — single source of truth for on-hand / low-stock  */
/* ------------------------------------------------------------------ */
export type UnitCounts = { total: number; in_stock: number; issued: number; maintenance: number; retired: number };
// Per-size rollup attached to `sized` items: total on-hand plus each size line.
export type VariantCounts = {
  total: number;
  sizes: { id: number; size: string; quantity: number; parLevel: number }[];
};

// Computed stock figures attached to each item in GET /api/items.
export type ItemWithStock = Item & {
  unitCounts?: UnitCounts;
  variantCounts?: VariantCounts;
  onHand: number;
  lowStock: boolean;
};

// On-hand (available) and low-stock are derived identically everywhere — the
// items API, dashboard, inventory, and reports all call this so the figures
// never diverge.
//   - serialized item WITH tracked units (unitCounts.total > 0):
//     onHand = in_stock units only (issued, maintenance, retired excluded).
//   - sized item WITH at least one variant (variantCounts.sizes > 0):
//     onHand = sum of variant quantities.
//   - otherwise (non-serialized, or serialized/sized with no tracked rows):
//     onHand = item.quantity.
//   - lowStock = parLevel > 0 && onHand <= parLevel (at or below par).
export function computeStock(
  item: Pick<Item, "type" | "quantity" | "parLevel">,
  unitCounts?: UnitCounts | null,
  variantCounts?: VariantCounts | null,
): { onHand: number; lowStock: boolean } {
  let onHand = item.quantity;
  if (item.type === "unique" && unitCounts && unitCounts.total > 0) {
    onHand = unitCounts.in_stock;
  } else if (item.type === "sized" && variantCounts && variantCounts.sizes.length > 0) {
    onHand = variantCounts.total;
  }
  const lowStock = item.parLevel > 0 && onHand <= item.parLevel;
  return { onHand, lowStock };
}

// Per-size low-stock flag for `sized` items (used by the manage-sizes dialog
// and the reorder report). A size is low when it has a par set and is at/below.
export function variantLowStock(v: Pick<ItemVariant, "quantity" | "parLevel">): boolean {
  return v.parLevel > 0 && v.quantity <= v.parLevel;
}

/* ------------------------------------------------------------------ */
/* Assignments — current possession of issued items                    */
/* ------------------------------------------------------------------ */
// status: active | returned
export const assignments = sqliteTable("assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull(),
  // Optional link to a specific serialized unit (item_units.id) when the issued
  // item is `unique`. Null for non-serialized assignments.
  itemUnitId: integer("item_unit_id"),
  // Optional link to a specific size (item_variants.id) when the issued item is
  // `sized`. Null for non-sized assignments.
  itemVariantId: integer("item_variant_id"),
  officerId: integer("officer_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  status: text("status").notNull().default("active"),
  conditionOut: text("condition_out").default("NEW"),
  conditionIn: text("condition_in"),
  issuedAt: text("issued_at").notNull(),
  dueDate: text("due_date"),
  returnedAt: text("returned_at"),
  issuedBy: text("issued_by"),
  issuedLocation: text("issued_location"),
  returnedBy: text("returned_by"),
  signature: text("signature"),
  notes: text("notes"),
});

export const insertAssignmentSchema = createInsertSchema(assignments).omit({ id: true });
export type InsertAssignment = z.infer<typeof insertAssignmentSchema>;
export type Assignment = typeof assignments.$inferSelect;

/* ------------------------------------------------------------------ */
/* Kits — new-hire / standard-issue templates                          */
/* ------------------------------------------------------------------ */
export const kits = sqliteTable("kits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
});

export const insertKitSchema = createInsertSchema(kits).omit({ id: true });
export type InsertKit = z.infer<typeof insertKitSchema>;
export type Kit = typeof kits.$inferSelect;

export const kitItems = sqliteTable("kit_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kitId: integer("kit_id").notNull(),
  itemId: integer("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
});

export const insertKitItemSchema = createInsertSchema(kitItems).omit({ id: true });
export type InsertKitItem = z.infer<typeof insertKitItemSchema>;
export type KitItem = typeof kitItems.$inferSelect;

/* ------------------------------------------------------------------ */
/* Audit log — append-only activity trail                              */
/* ------------------------------------------------------------------ */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(), // e.g. issue, return, create_item, update_item, login
  entity: text("entity"), // item | officer | assignment | user | kit
  entityId: integer("entity_id"),
  detail: text("detail"),
  username: text("username"),
  timestamp: text("timestamp").notNull(),
});

export const insertAuditSchema = createInsertSchema(auditLog).omit({ id: true });
export type InsertAudit = z.infer<typeof insertAuditSchema>;
export type AuditEntry = typeof auditLog.$inferSelect;

/* ------------------------------------------------------------------ */
/* Email log — record of every outbound email (#18)                    */
/* ------------------------------------------------------------------ */
// status: logged (recorded, not delivered) | sent (delivered by provider) | failed
// provider: log | resend | smtp
export const emailLog = sqliteTable("email_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  template: text("template"),
  status: text("status").notNull().default("logged"),
  provider: text("provider").notNull().default("log"),
  error: text("error"),
  relatedType: text("related_type"),
  relatedId: integer("related_id"),
  createdAt: text("created_at").notNull(),
});

export const insertEmailLogSchema = createInsertSchema(emailLog).omit({ id: true });
export type InsertEmailLog = z.infer<typeof insertEmailLogSchema>;
export type EmailLogEntry = typeof emailLog.$inferSelect;
