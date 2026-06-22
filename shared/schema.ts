import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Users — login accounts with role-based access                       */
/* ------------------------------------------------------------------ */
// Roles: admin | quartermaster | supervisor | officer | auditor
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("officer"),
  // optional link to a personnel record (for officer self-service)
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
// type: consumable (decrements, not returned) | returnable (bulk, returned) | unique (serialized, qty 1)
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
  condition: text("condition").default("New"),
  status: text("status").notNull().default("in_stock"),
  // inspection gating
  requiresInspection: integer("requires_inspection", { mode: "boolean" }).notNull().default(false),
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
  condition: text("condition").default("New"),
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
/* Assignments — current possession of issued items                    */
/* ------------------------------------------------------------------ */
// status: active | returned
export const assignments = sqliteTable("assignments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").notNull(),
  // Optional link to a specific serialized unit (item_units.id) when the issued
  // item is `unique`. Null for non-serialized assignments.
  itemUnitId: integer("item_unit_id"),
  officerId: integer("officer_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  status: text("status").notNull().default("active"),
  conditionOut: text("condition_out").default("New"),
  conditionIn: text("condition_in"),
  issuedAt: text("issued_at").notNull(),
  dueDate: text("due_date"),
  returnedAt: text("returned_at"),
  issuedBy: text("issued_by"),
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
