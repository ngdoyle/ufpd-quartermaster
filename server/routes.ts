import type { Express, Request, Response } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  insertOfficerSchema, insertItemSchema, insertUserSchema,
  insertKitSchema, computeStock,
} from "@shared/schema";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { hashPassword, verifyPassword, authProvider, authMode } from "./auth";
import { apiAuthGate, issueToken, revokeToken, bearerToken, requireRole } from "./session";

// Role guards mirror the client capability checks (see lib/app-context.ts).
// Reads are available to any authenticated user; writes are restricted here so
// the server — not just the UI — is the authorization boundary.
const writeGuard = requireRole("admin", "quartermaster");
const adminGuard = requireRole("admin");

// Re-export so existing importers keep working after the auth refactor.
export { hashPassword };

const nowISO = () => new Date().toISOString();
const stripPw = (u: any) => { if (!u) return u; const { password, ...rest } = u; return rest; };

/* ------------------- Brute-force protection --------------------- */
// Throttle repeated authentication attempts. Keyed on client IP + the
// attempted username so one attacker cannot lock out every account, and a
// single account cannot be hammered from one address. Successful logins do
// not count against the limit (skipSuccessfulRequests).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // max failed attempts per key per window
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ipKey = ipKeyGenerator(req.ip ?? "");
    const username = String(req.body?.username ?? "").trim().toLowerCase();
    return `${ipKey}|${username}`;
  },
  handler: (_req, res) => {
    res.status(429).json({
      message: "Too many sign-in attempts. Please wait a few minutes and try again.",
    });
  },
});

async function audit(action: string, entity: string, entityId: number | undefined, detail: string, username?: string) {
  await storage.addAudit({ action, entity, entityId: entityId ?? null as any, detail, username: username ?? null as any, timestamp: nowISO() });
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  /* --------------------- API authentication gate ------------------- */
  // Reject any /api request that does not carry a valid session token, except
  // the login endpoint itself. Registered before the routes below so it runs
  // first for every /api request. This protects the API even when the app is
  // hosted without the SSO reverse proxy that fronts it in production.
  app.use("/api", apiAuthGate);

  /* ----------------------------- AUTH ----------------------------- */
  app.post("/api/login", loginLimiter, async (req, res) => {
    // Delegate to the configured auth provider (local bcrypt by default, or
    // GatorLink SSO when AUTH_MODE=sso). The rest of the route is identical
    // regardless of strategy.
    const outcome = await authProvider.authenticate(req);
    if (!outcome.user) {
      return res.status(outcome.status).json({ message: outcome.message ?? "Authentication failed." });
    }
    const user = outcome.user;
    // Mint a server-side session token; the client returns it as a bearer
    // token on every subsequent API call (see apiAuthGate).
    const token = issueToken(user);
    await audit("login", "user", user.id, `${user.username} signed in via ${authMode}`, user.username);
    res.json({ ...stripPw(user), token });
  });

  // Sign out — invalidate the current session token server-side.
  app.post("/api/logout", async (req, res) => {
    revokeToken(bearerToken(req));
    res.json({ ok: true });
  });

  app.post("/api/change-password", loginLimiter, async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    // Bind strictly to the authenticated session — a user may only change their
    // OWN password. The client no longer dictates which account is affected.
    const user = await storage.getUser(Number(req.authUser?.userId));
    if (!user) return res.status(404).json({ message: "User not found." });
    const ok = await verifyPassword(String(currentPassword ?? ""), user);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect." });
    if (!newPassword || String(newPassword).length < 12) return res.status(400).json({ message: "New password must be at least 12 characters." });
    const updated = await storage.updateUser(user.id, { password: hashPassword(newPassword), mustChangePassword: false });
    await audit("change_password", "user", user.id, `${user.username} changed password`, user.username);
    res.json(stripPw(updated));
  });

  /* ----------------------------- USERS ---------------------------- */
  app.get("/api/users", async (_req, res) => {
    res.json((await storage.listUsers()).map(stripPw));
  });
  app.post("/api/users", adminGuard, async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      const existing = await storage.getUserByUsername(data.username);
      if (existing) return res.status(400).json({ message: "Username already exists." });
      // Hash the password before persisting (never store plaintext).
      const u = await storage.createUser({ ...data, password: hashPassword(data.password) });
      await audit("create_user", "user", u.id, `Created account ${u.username} (${u.role})`, req.body.actor);
      res.json(stripPw(u));
    } catch (e) { handleErr(e, res); }
  });
  app.patch("/api/users/:id", adminGuard, async (req, res) => {
    // If a password is being set/reset here, hash it before persisting.
    const patch = { ...req.body };
    if (patch.password) patch.password = hashPassword(patch.password);
    const u = await storage.updateUser(Number(req.params.id), patch);
    if (!u) return res.status(404).json({ message: "Not found" });
    await audit("update_user", "user", u.id, `Updated account ${u.username}`, req.body.actor);
    res.json(stripPw(u));
  });
  app.delete("/api/users/:id", adminGuard, async (req, res) => {
    await storage.deleteUser(Number(req.params.id));
    await audit("delete_user", "user", Number(req.params.id), `Deleted user #${req.params.id}`, req.query.actor as string);
    res.json({ ok: true });
  });

  /* ---------------------------- OFFICERS -------------------------- */
  app.get("/api/officers", async (_req, res) => res.json(await storage.listOfficers()));
  app.get("/api/officers/:id", async (req, res) => {
    const o = await storage.getOfficer(Number(req.params.id));
    if (!o) return res.status(404).json({ message: "Not found" });
    res.json(o);
  });
  app.post("/api/officers", writeGuard, async (req, res) => {
    try {
      const data = insertOfficerSchema.parse(req.body);
      const o = await storage.createOfficer(data);
      await audit("create_officer", "officer", o.id, `Added officer ${o.firstName} ${o.lastName} (#${o.badgeNumber})`, req.body.actor);
      res.json(o);
    } catch (e) { handleErr(e, res); }
  });
  // Bulk import officers from parsed CSV rows
  app.post("/api/officers/bulk", writeGuard, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const errors: { row: number; message: string }[] = [];
    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        const data = insertOfficerSchema.parse(rows[i]);
        if (!data.badgeNumber || !data.firstName || !data.lastName)
          throw new Error("Badge, First, and Last are required.");
        await storage.createOfficer(data);
        created++;
      } catch (e) {
        errors.push({ row: i + 2, message: zMsg(e) }); // +2 = header row + 1-indexed
      }
    }
    await audit("bulk_import_officers", "officer", undefined, `Bulk imported ${created} officer(s), ${errors.length} skipped`, req.body.actor);
    res.json({ created, errors });
  });
  app.patch("/api/officers/:id", writeGuard, async (req, res) => {
    const o = await storage.updateOfficer(Number(req.params.id), req.body);
    if (!o) return res.status(404).json({ message: "Not found" });
    await audit("update_officer", "officer", o.id, `Updated officer ${o.firstName} ${o.lastName}`, req.body.actor);
    res.json(o);
  });
  app.delete("/api/officers/:id", adminGuard, async (req, res) => {
    const id = Number(req.params.id);
    const officer = await storage.getOfficer(id);
    if (!officer) return res.status(404).json({ message: "Not found" });
    const officerAssignments = await storage.listAssignmentsByOfficer(id);
    if (officerAssignments.some((a) => a.status === "active"))
      return res.status(409).json({ message: "Cannot delete: officer has items currently issued. Return all items first." });
    await storage.deleteAssignmentsByOfficer(id);
    await storage.deleteOfficer(id);
    await audit("delete_officer", "officer", id, `Deleted officer ${officer.firstName} ${officer.lastName} (#${officer.badgeNumber}) and purged their assignment history`, req.query.actor as string);
    res.json({ ok: true });
  });

  /* ----------------------------- ITEMS ---------------------------- */
  app.get("/api/items", async (_req, res) => {
    const list = await storage.listItems();
    const counts = await storage.unitStatusCountsByItem();
    // Attach per-unit status counts to serialized items so the UI can show a
    // breakdown (e.g. "1 In Stock" + "1 Issued") and filter accurately, plus
    // computed onHand/lowStock (single source of truth — see computeStock).
    const out = list.map((i) => {
      const unitCounts = i.type === "unique"
        ? counts[i.id] ?? { total: 0, in_stock: 0, issued: 0, maintenance: 0, retired: 0 }
        : undefined;
      const { onHand, lowStock } = computeStock(i, unitCounts);
      return unitCounts ? { ...i, unitCounts, onHand, lowStock } : { ...i, onHand, lowStock };
    });
    res.json(out);
  });
  app.get("/api/items/:id", async (req, res) => {
    const i = await storage.getItem(Number(req.params.id));
    if (!i) return res.status(404).json({ message: "Not found" });
    res.json(i);
  });
  app.post("/api/items", writeGuard, async (req, res) => {
    try {
      const data = insertItemSchema.parse(req.body);
      const i = await storage.createItem(data);
      await audit("create_item", "item", i.id, `Added item "${i.name}" (qty ${i.quantity})`, req.body.actor);
      res.json(i);
    } catch (e) { handleErr(e, res); }
  });
  // Bulk import inventory items from parsed CSV rows
  app.post("/api/items/bulk", writeGuard, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const errors: { row: number; message: string }[] = [];
    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        const data = insertItemSchema.parse(rows[i]);
        if (!data.name) throw new Error("Name is required.");
        await storage.createItem(data);
        created++;
      } catch (e) {
        errors.push({ row: i + 2, message: zMsg(e) });
      }
    }
    await audit("bulk_import_items", "item", undefined, `Bulk imported ${created} item(s), ${errors.length} skipped`, req.body.actor);
    res.json({ created, errors });
  });
  app.patch("/api/items/:id", writeGuard, async (req, res) => {
    const i = await storage.updateItem(Number(req.params.id), req.body);
    if (!i) return res.status(404).json({ message: "Not found" });
    await audit("update_item", "item", i.id, `Updated item "${i.name}"`, req.body.actor);
    res.json(i);
  });
  app.delete("/api/items/:id", writeGuard, async (req, res) => {
    await storage.deleteItem(Number(req.params.id));
    await audit("delete_item", "item", Number(req.params.id), `Deleted item #${req.params.id}`, req.query.actor as string);
    res.json({ ok: true });
  });

  /* ---------------------- SERIALIZED UNITS ------------------------ */
  // List the serialized units belonging to a `unique` item.
  app.get("/api/items/:id/units", async (req, res) => {
    res.json(await storage.listUnitsByItem(Number(req.params.id)));
  });

  // Create one or many units for an item. Accepts a single unit body, a bulk
  // `serials: ["SN1", ...]` array (plain strings), or a structured
  // `units: [{serialNumber, secondarySerialNumber}, ...]` array (for vests).
  app.post("/api/items/:id/units", writeGuard, async (req, res) => {
    try {
      const itemId = Number(req.params.id);
      const item = await storage.getItem(itemId);
      if (!item) return res.status(404).json({ message: "Item not found." });
      const body = req.body ?? {};
      const created: any[] = [];

      const make = (serialNumber: string, secondary?: string | null) =>
        storage.createUnit({
          itemId,
          serialNumber: String(serialNumber).trim(),
          secondarySerialNumber: secondary != null && String(secondary).trim() !== "" ? String(secondary).trim() : null,
          condition: body.condition ?? "New",
          location: body.location ?? item.location ?? "",
          acquiredDate: body.acquiredDate ?? "",
          notes: body.notes ?? "",
        });

      if (Array.isArray(body.serials)) {
        for (const s of body.serials) {
          if (s == null || String(s).trim() === "") continue;
          created.push(await make(s, null));
        }
      } else if (Array.isArray(body.units)) {
        for (const u of body.units) {
          if (!u || String(u.serialNumber ?? "").trim() === "") continue;
          created.push(await make(u.serialNumber, u.secondarySerialNumber));
        }
      } else {
        if (String(body.serialNumber ?? "").trim() === "")
          return res.status(400).json({ message: "Serial number is required." });
        created.push(await make(body.serialNumber, body.secondarySerialNumber));
      }

      if (created.length === 0) return res.status(400).json({ message: "No valid serials provided." });
      await audit("add_unit", "item", itemId, `Added ${created.length} serialized unit(s) to "${item.name}"`, body.actor);
      res.json(created);
    } catch (e) { handleErr(e, res); }
  });

  app.patch("/api/units/:unitId", writeGuard, async (req, res) => {
    try {
      const unit = await storage.getUnit(Number(req.params.unitId));
      if (!unit) return res.status(404).json({ message: "Unit not found." });
      const { actor, ...patch } = req.body ?? {};
      const updated = await storage.updateUnit(unit.id, patch);
      const item = await storage.getItem(unit.itemId);
      await audit("update_unit", "item", unit.itemId, `Updated serial ${updated?.serialNumber ?? unit.serialNumber} on "${item?.name ?? `#${unit.itemId}`}"`, actor);
      res.json(updated);
    } catch (e) { handleErr(e, res); }
  });

  app.delete("/api/units/:unitId", writeGuard, async (req, res) => {
    const unit = await storage.getUnit(Number(req.params.unitId));
    if (!unit) return res.status(404).json({ message: "Unit not found." });
    await storage.deleteUnit(unit.id);
    const item = await storage.getItem(unit.itemId);
    await audit("delete_unit", "item", unit.itemId, `Removed serial ${unit.serialNumber} from "${item?.name ?? `#${unit.itemId}`}"`, req.query.actor as string);
    res.json({ ok: true });
  });

  /* ----------------------- ASSIGNMENTS / I-R ---------------------- */
  app.get("/api/assignments", async (_req, res) => res.json(await storage.listAssignments()));

  // Issue an item to an officer
  app.post("/api/issue", writeGuard, async (req, res) => {
    try {
      const schema = z.object({
        itemId: z.number(), officerId: z.number(), quantity: z.number().min(1).default(1),
        itemUnitId: z.number().nullish(),
        conditionOut: z.string().optional(), dueDate: z.string().nullish(),
        issuedBy: z.string().optional(), signature: z.string().optional(), notes: z.string().optional(),
      });
      const d = schema.parse(req.body);
      const item = await storage.getItem(d.itemId);
      const officer = await storage.getOfficer(d.officerId);
      if (!item) return res.status(404).json({ message: "Item not found." });
      if (!officer) return res.status(404).json({ message: "Officer not found." });

      let itemUnitId: number | null = null;
      if (item.type === "unique") {
        const units = await storage.listUnitsByItem(item.id);
        // Serialized items with tracked units must be issued by specific unit.
        if (units.length > 0) {
          const unit = d.itemUnitId ? await storage.getUnit(d.itemUnitId) : undefined;
          if (!unit || unit.itemId !== item.id)
            return res.status(400).json({ message: "Select a serial/unit to issue." });
          if (unit.status !== "in_stock")
            return res.status(400).json({ message: "That unit is not available to issue." });
          await storage.updateUnit(unit.id, { status: "issued", assignedOfficerId: officer.id });
          itemUnitId = unit.id;
        } else {
          // Legacy serialized item with no tracked units — fall back to status.
          if (item.quantity < d.quantity) return res.status(400).json({ message: `Only ${item.quantity} in stock.` });
          await storage.updateItem(item.id, { quantity: item.quantity - d.quantity, status: "issued" });
        }
      } else {
        if (item.quantity < d.quantity) return res.status(400).json({ message: `Only ${item.quantity} in stock.` });
        await storage.updateItem(item.id, { quantity: item.quantity - d.quantity });
      }
      const a = await storage.createAssignment({
        itemId: d.itemId, itemUnitId: itemUnitId as any, officerId: d.officerId, quantity: d.quantity, status: "active",
        conditionOut: d.conditionOut ?? item.condition ?? "New", conditionIn: null as any,
        issuedAt: nowISO(), dueDate: d.dueDate ?? null as any, returnedAt: null as any,
        issuedBy: d.issuedBy ?? null as any, returnedBy: null as any,
        signature: d.signature ?? null as any, notes: d.notes ?? null as any,
      });
      await audit("issue", "assignment", a.id,
        `Issued ${d.quantity}x "${item.name}" to ${officer.firstName} ${officer.lastName} (#${officer.badgeNumber})`, d.issuedBy);
      res.json(a);
    } catch (e) { handleErr(e, res); }
  });

  // Return an assignment
  app.post("/api/return/:assignmentId", writeGuard, async (req, res) => {
    try {
      const a = await storage.getAssignment(Number(req.params.assignmentId));
      if (!a) return res.status(404).json({ message: "Assignment not found." });
      if (a.status === "returned") return res.status(400).json({ message: "Already returned." });
      const item = await storage.getItem(a.itemId);
      const officer = await storage.getOfficer(a.officerId);
      const { conditionIn, returnedBy, notes } = req.body ?? {};
      const condition = conditionIn ?? "Good";

      await storage.updateAssignment(a.id, {
        status: "returned", conditionIn: condition, returnedAt: nowISO(),
        returnedBy: returnedBy ?? null, notes: notes ?? a.notes,
      });
      if (item && item.type === "unique" && a.itemUnitId) {
        // Serialized return: flip the specific unit back, then let the item
        // quantity/status re-derive from its units.
        await storage.updateUnit(a.itemUnitId, {
          status: item.requiresInspection ? "maintenance" : "in_stock",
          assignedOfficerId: null,
          condition,
        });
      } else if (item) {
        // Damaged returnable items go to maintenance if inspection required
        const backToStock = item.requiresInspection ? "maintenance" : "in_stock";
        await storage.updateItem(item.id, {
          quantity: item.quantity + a.quantity,
          status: item.type === "unique"
            ? (item.requiresInspection ? "maintenance" : "in_stock")
            : item.status,
          condition: condition,
          ...(item.requiresInspection ? { status: backToStock } : {}),
        });
      }
      await audit("return", "assignment", a.id,
        `Returned "${item?.name}" from ${officer?.firstName} ${officer?.lastName} — condition: ${condition}`, returnedBy);
      res.json({ ok: true });
    } catch (e) { handleErr(e, res); }
  });

  // Mark item inspected (clears maintenance hold)
  app.post("/api/items/:id/inspect", writeGuard, async (req, res) => {
    const item = await storage.getItem(Number(req.params.id));
    if (!item) return res.status(404).json({ message: "Not found" });
    const updated = await storage.updateItem(item.id, { lastInspected: nowISO(), status: "in_stock" });
    await audit("inspect", "item", item.id, `Inspection passed for "${item.name}"`, req.body.actor);
    res.json(updated);
  });

  /* ------------------------------ KITS ---------------------------- */
  app.get("/api/kits", async (_req, res) => {
    const ks = await storage.listKits();
    const out = [];
    for (const k of ks) out.push({ ...k, items: await storage.listKitItems(k.id) });
    res.json(out);
  });
  app.post("/api/kits", writeGuard, async (req, res) => {
    try {
      const data = insertKitSchema.parse(req.body);
      const k = await storage.createKit(data);
      const lines = Array.isArray(req.body.items) ? req.body.items : [];
      for (const l of lines) await storage.createKitItem({ kitId: k.id, itemId: l.itemId, quantity: l.quantity ?? 1 });
      await audit("create_kit", "kit", k.id, `Created kit template "${k.name}"`, req.body.actor);
      res.json({ ...k, items: await storage.listKitItems(k.id) });
    } catch (e) { handleErr(e, res); }
  });
  app.delete("/api/kits/:id", writeGuard, async (req, res) => {
    await storage.deleteKit(Number(req.params.id));
    res.json({ ok: true });
  });

  // Issue an entire kit to an officer. For serialized (`unique`) items the
  // caller must pick a specific in-stock unit per item via `unitSelections`
  // (a map of itemId -> itemUnitId); the request is rejected (400) if a
  // serialized item has no available unit, so a kit is never issued with a
  // null serial.
  app.post("/api/kits/:id/issue", writeGuard, async (req, res) => {
    try {
      const kitId = Number(req.params.id);
      const { officerId, issuedBy, dueDate, signature, notes } = req.body ?? {};
      const unitSelections: Record<string, number> = req.body?.unitSelections ?? {};
      const officer = await storage.getOfficer(Number(officerId));
      if (!officer) return res.status(404).json({ message: "Officer not found." });
      const lines = await storage.listKitItems(kitId);

      // Pre-validate serialized items before mutating anything so the kit issue
      // is all-or-nothing for the required serial picks.
      const unitByItem: Record<number, any> = {};
      for (const line of lines) {
        const item = await storage.getItem(line.itemId);
        if (!item || item.type !== "unique") continue;
        const units = await storage.listUnitsByItem(item.id);
        const inStock = units.filter((u) => u.status === "in_stock");
        if (inStock.length === 0)
          return res.status(400).json({ message: `No available ${item.name} units in stock — add a unit or remove it from the kit.` });
        const chosenId = unitSelections[String(item.id)];
        const chosen = chosenId ? inStock.find((u) => u.id === Number(chosenId)) : undefined;
        if (!chosen)
          return res.status(400).json({ message: `Select a serial/unit for ${item.name} before issuing the kit.` });
        unitByItem[item.id] = chosen;
      }

      const results: any[] = []; const skipped: string[] = [];
      for (const line of lines) {
        const item = await storage.getItem(line.itemId);
        if (!item) continue;
        let itemUnitId: number | null = null;
        if (item.type === "unique") {
          const unit = unitByItem[item.id];
          await storage.updateUnit(unit.id, { status: "issued", assignedOfficerId: officer.id });
          itemUnitId = unit.id;
        } else {
          if (item.quantity < line.quantity) { skipped.push(`${item.name} (insufficient stock)`); continue; }
          await storage.updateItem(item.id, { quantity: item.quantity - line.quantity });
        }
        const a = await storage.createAssignment({
          itemId: item.id, itemUnitId: itemUnitId as any, officerId: officer.id, quantity: line.quantity, status: "active",
          conditionOut: item.condition ?? "New", conditionIn: null as any,
          issuedAt: nowISO(), dueDate: dueDate ?? null as any, returnedAt: null as any,
          issuedBy: issuedBy ?? null as any, returnedBy: null as any,
          signature: signature ?? null as any, notes: notes ?? "Kit issue",
        });
        results.push(a);
      }
      await audit("issue_kit", "officer", officer.id,
        `Issued kit to ${officer.firstName} ${officer.lastName} — ${results.length} items${skipped.length ? `, ${skipped.length} skipped` : ""}`, issuedBy);
      res.json({ issued: results.length, skipped });
    } catch (e) { handleErr(e, res); }
  });

  // Set or change the serialized unit on an active assignment (e.g. a kit-issued
  // serialized item whose serial needs to be set or corrected after the fact).
  app.patch("/api/assignments/:id/unit", writeGuard, async (req, res) => {
    try {
      const a = await storage.getAssignment(Number(req.params.id));
      if (!a) return res.status(404).json({ message: "Assignment not found." });
      if (a.status !== "active") return res.status(400).json({ message: "Only active assignments can be changed." });
      const { itemUnitId, actor } = req.body ?? {};
      const unit = itemUnitId ? await storage.getUnit(Number(itemUnitId)) : undefined;
      if (!unit || unit.itemId !== a.itemId)
        return res.status(400).json({ message: "Invalid unit for this item." });
      // The target unit must be free, unless it is already the one on this assignment.
      if (unit.id !== a.itemUnitId && unit.status !== "in_stock")
        return res.status(400).json({ message: "That unit is not available." });

      // Release the previously-assigned unit (if any and different).
      if (a.itemUnitId && a.itemUnitId !== unit.id) {
        await storage.updateUnit(a.itemUnitId, { status: "in_stock", assignedOfficerId: null });
      }
      await storage.updateUnit(unit.id, { status: "issued", assignedOfficerId: a.officerId });
      const updated = await storage.updateAssignment(a.id, { itemUnitId: unit.id });
      const item = await storage.getItem(a.itemId);
      await audit("assign_unit", "assignment", a.id,
        `Set serial ${unit.serialNumber} on "${item?.name ?? `#${a.itemId}`}" assignment #${a.id}`, actor);
      res.json(updated);
    } catch (e) { handleErr(e, res); }
  });

  /* ----------------------------- AUDIT ---------------------------- */
  app.get("/api/audit", async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json(await storage.listAudit(limit));
  });

  /* --------------------------- DASHBOARD -------------------------- */
  app.get("/api/dashboard", async (_req, res) => {
    const allItems = await storage.listItems();
    const active = await storage.listActiveAssignments();
    const officers = await storage.listOfficers();
    const today = new Date();
    const in90 = new Date(); in90.setDate(today.getDate() + 90);

    const counts = await storage.unitStatusCountsByItem();
    const withStock = allItems.map(i => {
      const uc = i.type === "unique" ? counts[i.id] : undefined;
      return { ...i, ...computeStock(i, uc) };
    });
    const lowStock = withStock.filter(i => i.lowStock);
    const expiring = allItems.filter(i => i.expirationDate && new Date(i.expirationDate) <= in90);
    const expired = allItems.filter(i => i.expirationDate && new Date(i.expirationDate) < today);
    const overdue = active.filter(a => a.dueDate && new Date(a.dueDate) < today);
    const totalValue = allItems.reduce((s, i) => s + (i.unitCost ?? 0) * i.quantity, 0);
    const maintenance = allItems.filter(i => i.status === "maintenance");

    res.json({
      counts: {
        items: allItems.length,
        officers: officers.length,
        issued: active.length,
        lowStock: lowStock.length,
        expiring: expiring.length,
        expired: expired.length,
        overdue: overdue.length,
        maintenance: maintenance.length,
        totalValue,
      },
      lowStock, expiring, overdue, recent: await storage.listAudit(12),
    });
  });

  return httpServer;
}

function zMsg(e: unknown): string {
  if (e instanceof z.ZodError) return e.errors.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ");
  return (e as Error).message ?? "Invalid row";
}

function handleErr(e: unknown, res: Response) {
  if (e instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", errors: e.errors });
  console.error(e);
  res.status(500).json({ message: (e as Error).message ?? "Server error" });
}
