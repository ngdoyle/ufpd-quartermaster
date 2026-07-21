import type { Express, Request, Response } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  insertOfficerSchema, insertItemSchema, insertUserSchema,
  insertKitSchema, computeStock,
} from "@shared/schema";
import type { InsertItemVariant, InsertAssignment, Officer } from "@shared/schema";
import type { IssueBatchPlan, KitIssuePlan, ReturnPlan } from "./storage";
import { isValidEmail, isValidPhone, normalizePhone, isWholeNonNeg, isMoneyNonNeg, isValidCondition, normalizeCondition, CONDITIONS } from "@shared/validation";
import { sendEmail, activeProvider } from "./email";
import { z } from "zod";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { hashPassword, verifyPassword, authProvider, authMode } from "./auth";
import { apiAuthGate, issueToken, revokeToken, bearerToken, requireRole, revokeUserSessions } from "./session";
import { randomBytes } from "node:crypto";

// Role guards mirror the client capability checks (see lib/app-context.ts).
// Reads are available to any authenticated user; writes are restricted here so
// the server — not just the UI — is the authorization boundary.
const writeGuard = requireRole("admin", "quartermaster");
const adminGuard = requireRole("admin");

// Re-export so existing importers keep working after the auth refactor.
export { hashPassword };

const nowISO = () => new Date().toISOString();
const stripPw = (u: any) => { if (!u) return u; const { password, ...rest } = u; return rest; };

// Generate a cryptographically secure temporary password. Uses an unambiguous
// charset (no 0/O, 1/l/I) so it can be read off an email without confusion.
// Each character is drawn with rejection sampling to avoid modulo bias.
function generateTempPassword(length = 14): string {
  const charset = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const max = 256 - (256 % charset.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue; // reject to keep the distribution uniform
      out += charset[byte % charset.length];
      if (out.length === length) break;
    }
  }
  return out;
}

// Server-side enforcement of the USER-APPROVED #19 required set + formats. The
// server is the authorization/validation boundary — the client rules mirror it.
// Returns an error string on the first failure, or null when valid.
function validateOfficerCreate(b: any): string | null {
  const has = (v: unknown) => String(v ?? "").trim().length > 0;
  const business = String(b?.type ?? "person") === "business";
  if (business) {
    if (!has(b.firstName)) return "Business name is required.";
  } else {
    if (!has(b.firstName)) return "First name is required.";
    if (!has(b.lastName)) return "Last name is required.";
    if (!has(b.badgeNumber)) return "Badge number is required.";
    if (!has(b.unit)) return "Rank/unit is required.";
    if (!has(b.email)) return "Email is required.";
    if (!has(b.phone)) return "Phone is required.";
  }
  if (has(b.email) && !isValidEmail(b.email)) return "Enter a valid email address.";
  if (has(b.phone) && !isValidPhone(b.phone)) return "Enter a 10-digit US phone number.";
  return null;
}

function validateItemCreate(b: any): string | null {
  const has = (v: unknown) => String(v ?? "").trim().length > 0;
  if (!has(b.name)) return "Name is required.";
  if (!has(b.category)) return "Category is required.";
  if (!has(b.type)) return "Type is required.";
  if (!has(b.location)) return "Location is required.";
  if (b.type !== "sized" && b.quantity != null && !isWholeNonNeg(b.quantity)) return "Quantity must be a whole number ≥ 0.";
  if (b.parLevel != null && b.parLevel !== "" && !isWholeNonNeg(b.parLevel)) return "PAR must be a whole number ≥ 0.";
  if (b.unitCost != null && b.unitCost !== "" && !isMoneyNonNeg(b.unitCost)) return "Unit cost must be a dollar amount ≥ 0.";
  if (has(b.condition) && !isValidCondition(b.condition)) return conditionError;
  return null;
}

// Shared message for an out-of-vocabulary condition (Batch 2 #10).
const conditionError = `Condition must be one of: ${CONDITIONS.join(", ")}.`;

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
  // Keep detail as plain text and bounded (~300 chars) — truncate gracefully so
  // a huge diff can never blow past the column's practical display width.
  const MAX = 300;
  const safe = detail.length > MAX ? detail.slice(0, MAX - 1) + "…" : detail;
  await storage.addAudit({ action, entity, entityId: entityId ?? null as any, detail: safe, username: username ?? null as any, timestamp: nowISO() });
}

// Human-readable before→after diff for audit `detail`. Compares only the fields
// present in `patch`; lists each changed field as `field: old → new` and adds a
// signed delta for numeric fields (e.g. `quantity: 500 → 8000 (+7500)`).
function diffDetail(before: Record<string, any> | undefined, after: Record<string, any> | undefined, patch: Record<string, any>, skip: string[] = []): string {
  const skipSet = new Set([...skip, "actor"]);
  const fmt = (v: any) => (v == null || v === "") ? "(empty)" : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  const parts: string[] = [];
  for (const f of Object.keys(patch)) {
    if (skipSet.has(f)) continue;
    const o = before?.[f];
    const n = after?.[f];
    if (o === n) continue;
    if ((o == null || o === "") && (n == null || n === "")) continue;
    if (typeof o === "number" && typeof n === "number") {
      const delta = n - o;
      parts.push(`${f}: ${o} → ${n} (${delta >= 0 ? "+" : ""}${delta})`);
    } else {
      parts.push(`${f}: ${fmt(o)} → ${fmt(n)}`);
    }
  }
  return parts.join(", ");
}

// Audit-friendly recipient label: businesses have no badge/last name.
function recipientLabel(o: { type?: string | null; firstName: string; lastName?: string | null; badgeNumber?: string | null }): string {
  if ((o.type ?? "person") === "business") return `"${o.firstName}"`;
  return `${o.firstName} ${o.lastName ?? ""} (#${o.badgeNumber ?? ""})`;
}

type IssueLineInput = { itemId: number; quantity: number; itemUnitId?: number | null; itemVariantId?: number | null; conditionOut?: string | null };
type IssueOpts = { dueDate?: string | null; signature?: string; notes?: string; conditionOut?: string; issuedBy?: string; issuedLocation?: string };
type PlanLineError = { index: number; message: string; code: number };
type IssuePlanResult =
  | ({ ok: true; auditDetails: string[] } & IssueBatchPlan)
  | { ok: false; errors: PlanLineError[] };

// Shared issue planner used by both POST /api/issue (single line) and
// POST /api/issue/batch. Validates every line against current stock — with no
// writes — while aggregating duplicate lines (same variant / same item) and
// reserving serialized units across the whole batch. On success it returns
// pre-computed, aggregated stock deltas plus one assignment per line, ready to
// hand to storage.issueBatch. On failure it returns every failing line so the
// caller can reject the whole batch (all-or-nothing).
async function planIssue(officer: Officer, lines: IssueLineInput[], opts: IssueOpts): Promise<IssuePlanResult> {
  const errors: PlanLineError[] = [];
  const assignments: InsertAssignment[] = [];
  const auditDetails: string[] = [];
  // #9: per-line condition changes to push onto serialized units after the batch
  // (the issue_batch RPC only sets status/assignedOfficerId, never condition).
  const unitConditionUpdates: { id: number; condition: string }[] = [];

  const itemCache = new Map<number, Awaited<ReturnType<typeof storage.getItem>>>();
  const unitsCache = new Map<number, Awaited<ReturnType<typeof storage.listUnitsByItem>>>();
  const variantCache = new Map<number, Awaited<ReturnType<typeof storage.getVariant>>>();
  const usedUnitIds = new Set<number>();
  const variantRemaining = new Map<number, number>(); // variantId -> running available
  const itemRemaining = new Map<number, number>();     // itemId -> running available
  const itemSetIssued = new Set<number>();             // unit-less unique items to mark "issued"

  const getItemCached = async (id: number) => {
    if (!itemCache.has(id)) itemCache.set(id, await storage.getItem(id));
    return itemCache.get(id);
  };
  const getUnitsCached = async (id: number) => {
    if (!unitsCache.has(id)) unitsCache.set(id, await storage.listUnitsByItem(id));
    return unitsCache.get(id)!;
  };
  const getVariantCached = async (id: number) => {
    if (!variantCache.has(id)) variantCache.set(id, await storage.getVariant(id));
    return variantCache.get(id);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fail = (message: string, code: number) => errors.push({ index: i, message, code });
    const item = await getItemCached(line.itemId);
    if (!item) { fail("Item not found.", 404); continue; }
    if (line.conditionOut != null && line.conditionOut !== "" && !isValidCondition(normalizeCondition(line.conditionOut))) {
      fail(conditionError, 400); continue;
    }

    let itemUnitId: number | null = null;
    let itemVariantId: number | null = null;
    let sizeSuffix = "";
    let serialInfo = "";
    let resolvedUnit: Awaited<ReturnType<typeof storage.getUnit>> | null = null;

    if (item.type === "sized") {
      const variant = line.itemVariantId ? await getVariantCached(line.itemVariantId) : undefined;
      if (!variant || variant.itemId !== item.id) { fail("Select a size to issue.", 400); continue; }
      if (!variantRemaining.has(variant.id)) variantRemaining.set(variant.id, variant.quantity);
      const remaining = variantRemaining.get(variant.id)!;
      if (remaining < line.quantity) { fail(`Only ${variant.quantity} of size ${variant.size} in stock.`, 409); continue; }
      variantRemaining.set(variant.id, remaining - line.quantity);
      itemVariantId = variant.id;
      sizeSuffix = ` (size ${variant.size})`;
    } else if (item.type === "unique") {
      const units = await getUnitsCached(item.id);
      if (units.length > 0) {
        const unit = line.itemUnitId ? units.find((u) => u.id === line.itemUnitId) : undefined;
        if (!unit || unit.itemId !== item.id) { fail("Select a serial/unit to issue.", 400); continue; }
        if (unit.status !== "in_stock") { fail("That unit is not available to issue.", 400); continue; }
        if (usedUnitIds.has(unit.id)) { fail("That unit is already selected on another line.", 409); continue; }
        usedUnitIds.add(unit.id);
        itemUnitId = unit.id;
        resolvedUnit = unit;
        serialInfo = item.requiresDualSerial && unit.secondarySerialNumber
          ? ` [FP ${unit.serialNumber} / BP ${unit.secondarySerialNumber}]`
          : ` [serial ${unit.serialNumber}]`;
      } else {
        // Legacy serialized item with no tracked units — fall back to quantity.
        if (!itemRemaining.has(item.id)) itemRemaining.set(item.id, item.quantity);
        const remaining = itemRemaining.get(item.id)!;
        if (remaining < line.quantity) { fail(`Only ${item.quantity} in stock.`, 400); continue; }
        itemRemaining.set(item.id, remaining - line.quantity);
        itemSetIssued.add(item.id);
      }
    } else {
      if (!itemRemaining.has(item.id)) itemRemaining.set(item.id, item.quantity);
      const remaining = itemRemaining.get(item.id)!;
      if (remaining < line.quantity) { fail(`Only ${item.quantity} in stock.`, 400); continue; }
      itemRemaining.set(item.id, remaining - line.quantity);
    }

    // #9: condition chosen per cart line, defaulting to the unit's/item's current
    // condition. When it differs from a serialized unit's stored condition, queue a
    // post-batch update (issue_batch never touches condition) and note it in the audit.
    const lineCondition = normalizeCondition(line.conditionOut ?? opts.conditionOut ?? resolvedUnit?.condition ?? item.condition ?? "NEW");
    let condChanged = false;
    if (resolvedUnit) {
      const current = normalizeCondition(resolvedUnit.condition ?? "NEW");
      if (current !== lineCondition) {
        unitConditionUpdates.push({ id: resolvedUnit.id, condition: lineCondition });
        condChanged = true;
      }
    }

    assignments.push({
      itemId: item.id, itemUnitId: itemUnitId as any, itemVariantId: itemVariantId as any,
      officerId: officer.id, quantity: line.quantity, status: "active",
      conditionOut: lineCondition, conditionIn: null as any,
      issuedAt: nowISO(), dueDate: opts.dueDate ?? null as any, returnedAt: null as any,
      issuedBy: opts.issuedBy ?? null as any, issuedLocation: opts.issuedLocation ?? null as any,
      returnedBy: null as any,
      signature: opts.signature ?? null as any, notes: opts.notes ?? null as any,
    });
    const byPart = opts.issuedBy ? `, by ${opts.issuedBy}` : "";
    const locPart = opts.issuedLocation ? `, at ${opts.issuedLocation}` : "";
    const condPart = condChanged ? `, condition set to ${lineCondition}` : "";
    auditDetails.push(`Issued ${line.quantity}x "${item.name}"${sizeSuffix}${serialInfo} to ${recipientLabel(officer)}${byPart}${locPart}${condPart}`);
  }

  if (errors.length) return { ok: false, errors };

  const variantDeltas = Array.from(variantRemaining.entries()).map(([id, newQty]) => ({ id, newQty }));
  const itemDeltas = Array.from(itemRemaining.entries()).map(([id, newQty]) => ({ id, newQty, setIssued: itemSetIssued.has(id) }));
  const unitIssues = Array.from(usedUnitIds).map((id) => ({ id, officerId: officer.id }));
  return { ok: true, variantDeltas, itemDeltas, unitIssues, assignments, auditDetails, unitConditionUpdates };
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
    // Revoke other live sessions for this account (best effort), then re-issue a
    // token for the current request so the caller is not logged out mid-flow.
    revokeUserSessions(user.id);
    const token = issueToken(updated ?? user);
    res.json({ ...stripPw(updated), token });
  });

  /* ----------------------------- USERS ---------------------------- */
  app.get("/api/users", async (_req, res) => {
    res.json((await storage.listUsers()).map(stripPw));
  });
  app.post("/api/users", adminGuard, async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      if (data.email && !isValidEmail(data.email)) return res.status(400).json({ message: "Enter a valid email address." });
      const existing = await storage.getUserByUsername(data.username);
      if (existing) return res.status(400).json({ message: "Username already exists." });
      // Hash the password before persisting (never store plaintext).
      const u = await storage.createUser({ ...data, password: hashPassword(data.password) });
      await audit("create_user", "user", u.id, `Created account ${u.username} (${u.role})`, req.body.actor);
      res.json(stripPw(u));
    } catch (e) { handleErr(e, res); }
  });
  app.patch("/api/users/:id", adminGuard, async (req, res) => {
    // Admins never set passwords directly — password changes go through the
    // self-service change-password flow or the admin "Reset Password" endpoint.
    // Silently drop any password field so it can't be set here.
    const { actor, password: _ignored, ...patch } = req.body ?? {};
    if (patch.email !== undefined && patch.email !== null && patch.email !== "" && !isValidEmail(patch.email))
      return res.status(400).json({ message: "Enter a valid email address." });
    const before = await storage.getUser(Number(req.params.id));
    if (!before) return res.status(404).json({ message: "Not found" });
    // Guard: don't allow the last remaining admin to be demoted or disabled.
    const losesAdmin = before.role === "admin" && ((patch.role && patch.role !== "admin") || patch.active === false);
    if (losesAdmin) {
      const admins = (await storage.listUsers()).filter((x) => x.role === "admin" && x.active && x.id !== before.id);
      if (admins.length === 0)
        return res.status(400).json({ message: "Cannot demote or disable the last administrator." });
    }
    const u = await storage.updateUser(Number(req.params.id), patch);
    if (!u) return res.status(404).json({ message: "Not found" });
    const diff = diffDetail(before, u, patch, ["password"]);
    await audit("update_user", "user", u.id, `Updated account ${u.username}${diff ? ` — ${diff}` : ""}`, actor);
    res.json(stripPw(u));
  });
  app.delete("/api/users/:id", adminGuard, async (req, res) => {
    const before = await storage.getUser(Number(req.params.id));
    if (before?.role === "admin") {
      const admins = (await storage.listUsers()).filter((x) => x.role === "admin" && x.active && x.id !== before.id);
      if (admins.length === 0)
        return res.status(400).json({ message: "Cannot delete the last administrator." });
    }
    await storage.deleteUser(Number(req.params.id));
    await audit("delete_user", "user", Number(req.params.id), `Deleted account ${before?.username ?? `#${req.params.id}`}`, req.query.actor as string);
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
      const err = validateOfficerCreate(req.body);
      if (err) return res.status(400).json({ message: err });
      const data = insertOfficerSchema.parse(req.body);
      if (data.phone) data.phone = normalizePhone(data.phone);
      const o = await storage.createOfficer(data);
      await audit("create_officer", "officer", o.id,
        o.type === "business" ? `Added business "${o.firstName}"` : `Added officer ${o.firstName} ${o.lastName} (#${o.badgeNumber})`,
        req.body.actor);
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
    const { actor, ...patch } = req.body ?? {};
    // EDIT is intentionally lenient so legacy records are never locked out: we
    // normalize a phone to canonical form when it is a clean 10-digit number,
    // but otherwise leave supplied values untouched (client enforces formats on
    // fields the user actually edits). CREATE remains strict.
    if (patch.phone != null && String(patch.phone).trim()) patch.phone = normalizePhone(patch.phone);
    const before = await storage.getOfficer(Number(req.params.id));
    const o = await storage.updateOfficer(Number(req.params.id), patch);
    if (!o) return res.status(404).json({ message: "Not found" });
    const diff = diffDetail(before, o, patch);
    const label = o.type === "business" ? `business "${o.firstName}"` : `officer ${o.firstName} ${o.lastName} (#${o.badgeNumber})`;
    await audit("update_officer", "officer", o.id, `Updated ${label}${diff ? ` — ${diff}` : ""}`, actor);
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
    await audit("delete_officer", "officer", id,
      officer.type === "business"
        ? `Deleted business "${officer.firstName}" and purged its assignment history`
        : `Deleted officer ${officer.firstName} ${officer.lastName} (#${officer.badgeNumber}) and purged their assignment history`,
      req.query.actor as string);
    res.json({ ok: true });
  });

  /* ----------------------------- ITEMS ---------------------------- */
  app.get("/api/items", async (_req, res) => {
    const list = await storage.listItems();
    const counts = await storage.unitStatusCountsByItem();
    const variantCounts = await storage.variantCountsByItem();
    // Attach per-unit status counts to serialized items so the UI can show a
    // breakdown (e.g. "1 In Stock" + "1 Issued") and filter accurately; attach
    // the per-size rollup to sized items (total + each size) so onHand is the
    // sum of variant quantities. Both feed computed onHand/lowStock (single
    // source of truth — see computeStock).
    const out = list.map((i) => {
      const unitCounts = i.type === "unique"
        ? counts[i.id] ?? { total: 0, in_stock: 0, issued: 0, maintenance: 0, retired: 0 }
        : undefined;
      const vCounts = i.type === "sized"
        ? variantCounts[i.id] ?? { total: 0, sizes: [] }
        : undefined;
      const { onHand, lowStock } = computeStock(i, unitCounts, vCounts);
      return {
        ...i,
        ...(unitCounts ? { unitCounts } : {}),
        ...(vCounts ? { variantCounts: vCounts } : {}),
        onHand, lowStock,
      };
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
      const err = validateItemCreate(req.body);
      if (err) return res.status(400).json({ message: err });
      const data = insertItemSchema.parse(req.body);
      const i = await storage.createItem(data);
      await audit("create_item", "item", i.id, `Added item "${i.name}" (qty ${i.quantity})`, req.body.actor);
      res.json(i);
    } catch (e) { handleErr(e, res); }
  });
  // Bulk import inventory items from parsed CSV rows.
  //  - Non-sized rows: one item per row (unchanged behavior).
  //  - Sized rows (Type "sized"/"clothing"): grouped by (Name, Category)
  //    case-insensitively into ONE item with one variant per row. Rows missing
  //    a size are reported as errors; duplicate sizes within a group merge by
  //    summing quantity; if a matching sized item already exists, variants are
  //    added/merged into it instead of creating a duplicate item.
  app.post("/api/items/bulk", writeGuard, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const errors: { row: number; message: string }[] = [];
    let created = 0;

    const SIZED_ALIASES = new Set(["sized", "clothing"]);
    const isSized = (r: any) => SIZED_ALIASES.has(String(r?.type ?? "").trim().toLowerCase());
    const normReturn = (v: unknown) => String(v ?? "").trim().toLowerCase() === "consumable" ? "consumable" : "returnable";

    // --- non-sized rows: unchanged one-item-per-row behavior ---
    for (let i = 0; i < rows.length; i++) {
      if (isSized(rows[i])) continue;
      try {
        const data = insertItemSchema.parse(rows[i]);
        if (!data.name) throw new Error("Name is required.");
        await storage.createItem(data);
        created++;
      } catch (e) {
        errors.push({ row: i + 2, message: zMsg(e) });
      }
    }

    // --- sized rows: group by (name, category) case-insensitive ---
    type SizeAgg = { size: string; quantity: number; parLevel: number; sku: string | null };
    type Group = { name: string; category: string; returnBehavior: string; template: any; firstRow: number; rowCount: number; sizes: Map<string, SizeAgg> };
    const groups = new Map<string, Group>();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!isSized(r)) continue;
      const rowNum = i + 2;
      const name = String(r.name ?? "").trim();
      const category = String(r.category ?? "General").trim() || "General";
      if (!name) { errors.push({ row: rowNum, message: "Name is required." }); continue; }
      const size = String(r.size ?? "").trim();
      if (!size) { errors.push({ row: rowNum, message: "Size is required for sized/clothing items." }); continue; }
      const key = `${name.toLowerCase()}||${category.toLowerCase()}`;
      let g = groups.get(key);
      if (!g) {
        g = { name, category, returnBehavior: normReturn(r.returnBehavior), template: r, firstRow: rowNum, rowCount: 0, sizes: new Map() };
        groups.set(key, g);
      }
      const sizeKey = size.toLowerCase();
      const qty = Number(r.quantity) || 0;
      const par = Number(r.parLevel) || 0;
      const sku = r.sku != null && String(r.sku).trim() !== "" ? String(r.sku).trim() : null;
      const existing = g.sizes.get(sizeKey);
      if (existing) existing.quantity += qty; // merge duplicate size within group
      else g.sizes.set(sizeKey, { size, quantity: qty, parLevel: par, sku });
      g.rowCount++;
    }

    // --- create/merge each sized group ---
    for (const g of Array.from(groups.values())) {
      try {
        const all = await storage.listItems();
        let item = all.find((it) =>
          it.type === "sized" &&
          it.name.trim().toLowerCase() === g.name.toLowerCase() &&
          (it.category ?? "").trim().toLowerCase() === g.category.toLowerCase());
        if (!item) {
          const base = insertItemSchema.parse({
            ...g.template, type: "sized", quantity: 0, parLevel: 0, size: "", returnBehavior: g.returnBehavior,
          });
          item = await storage.createItem(base);
        }
        const existingVariants = await storage.listVariants(item.id);
        for (const s of Array.from(g.sizes.values())) {
          const match = existingVariants.find((v) => v.size.trim().toLowerCase() === s.size.toLowerCase());
          if (match) await storage.updateVariant(match.id, { quantity: match.quantity + s.quantity });
          else existingVariants.push(await storage.createVariant({ itemId: item.id, size: s.size, sku: s.sku, quantity: s.quantity, parLevel: s.parLevel, notes: null }));
        }
        created += g.rowCount;
      } catch (e) {
        errors.push({ row: g.firstRow, message: `${g.name}: ${zMsg(e)}` });
      }
    }

    await audit("bulk_import_items", "item", undefined, `Bulk imported ${created} item(s), ${errors.length} skipped`, req.body.actor);
    res.json({ created, errors });
  });
  app.patch("/api/items/:id", writeGuard, async (req, res) => {
    const { actor, ...patch } = req.body ?? {};
    if (patch.condition != null && patch.condition !== "" && !isValidCondition(patch.condition))
      return res.status(400).json({ message: conditionError });
    const before = await storage.getItem(Number(req.params.id));
    const i = await storage.updateItem(Number(req.params.id), patch);
    if (!i) return res.status(404).json({ message: "Not found" });
    const diff = diffDetail(before, i, patch);
    await audit("update_item", "item", i.id, `Updated item "${i.name}"${diff ? ` — ${diff}` : ""}`, actor);
    res.json(i);
  });
  app.delete("/api/items/:id", writeGuard, async (req, res) => {
    const before = await storage.getItem(Number(req.params.id));
    await storage.deleteItem(Number(req.params.id));
    await audit("delete_item", "item", Number(req.params.id), `Deleted item "${before?.name ?? `#${req.params.id}`}"`, req.query.actor as string);
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
      if (body.condition != null && body.condition !== "" && !isValidCondition(body.condition))
        return res.status(400).json({ message: conditionError });
      const created: any[] = [];

      const make = (serialNumber: string, secondary?: string | null) => {
        const primary = String(serialNumber).trim();
        const sec = secondary != null && String(secondary).trim() !== "" ? String(secondary).trim() : null;
        // Dual-serial items (ballistic vests) require BOTH panels.
        if (item.requiresDualSerial && !sec)
          throw Object.assign(new Error("Both FP (front panel) and BP (back panel) serials are required."), { status: 400 });
        return storage.createUnit({
          itemId,
          serialNumber: primary,
          secondarySerialNumber: sec,
          condition: body.condition ?? "NEW",
          location: body.location ?? item.location ?? "",
          acquiredDate: body.acquiredDate ?? "",
          notes: body.notes ?? "",
        });
      };

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
      const serialList = created.map((u) => item.requiresDualSerial && u.secondarySerialNumber
        ? `FP ${u.serialNumber} / BP ${u.secondarySerialNumber}`
        : u.serialNumber).join(", ");
      await audit("add_unit", "item", itemId, `Added ${created.length} serialized unit(s) to "${item.name}": ${serialList}`, body.actor);
      res.json(created);
    } catch (e) { handleErr(e, res); }
  });

  app.patch("/api/units/:unitId", writeGuard, async (req, res) => {
    try {
      const unit = await storage.getUnit(Number(req.params.unitId));
      if (!unit) return res.status(404).json({ message: "Unit not found." });
      const { actor, ...patch } = req.body ?? {};
      if (patch.condition != null && patch.condition !== "" && !isValidCondition(patch.condition))
        return res.status(400).json({ message: conditionError });
      const item = await storage.getItem(unit.itemId);
      // Dual-serial items require both panels remain populated after an edit.
      if (item?.requiresDualSerial) {
        const nextSecondary = "secondarySerialNumber" in patch ? patch.secondarySerialNumber : unit.secondarySerialNumber;
        const nextPrimary = "serialNumber" in patch ? patch.serialNumber : unit.serialNumber;
        if (!nextPrimary || String(nextPrimary).trim() === "" || !nextSecondary || String(nextSecondary).trim() === "")
          return res.status(400).json({ message: "Both FP (front panel) and BP (back panel) serials are required." });
      }
      const updated = await storage.updateUnit(unit.id, patch);
      const serialLabel = item?.requiresDualSerial && updated?.secondarySerialNumber
        ? `FP ${updated.serialNumber} / BP ${updated.secondarySerialNumber}`
        : (updated?.serialNumber ?? unit.serialNumber);
      const diff = diffDetail(unit, updated, patch);
      await audit("update_unit", "item", unit.itemId, `Updated serial ${serialLabel} on "${item?.name ?? `#${unit.itemId}`}"${diff ? ` — ${diff}` : ""}`, actor);
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

  /* ------------------------ SIZE VARIANTS ------------------------- */
  // List the size variants belonging to a `sized` item.
  app.get("/api/items/:id/variants", async (req, res) => {
    res.json(await storage.listVariants(Number(req.params.id)));
  });

  const normSize = (s: unknown) => String(s ?? "").trim();

  // Create a size variant. Rejects a duplicate size (case-insensitive) on the
  // same item with 409 so stock is never split across two rows for one size.
  app.post("/api/items/:id/variants", writeGuard, async (req, res) => {
    try {
      const itemId = Number(req.params.id);
      const item = await storage.getItem(itemId);
      if (!item) return res.status(404).json({ message: "Item not found." });
      const body = req.body ?? {};
      const size = normSize(body.size);
      if (!size) return res.status(400).json({ message: "Size is required." });
      const existing = await storage.listVariants(itemId);
      if (existing.some((v) => v.size.trim().toLowerCase() === size.toLowerCase()))
        return res.status(409).json({ message: `Size "${size}" already exists for this item.` });
      const payload: InsertItemVariant = {
        itemId,
        size,
        sku: body.sku != null && String(body.sku).trim() !== "" ? String(body.sku).trim() : null,
        quantity: Number(body.quantity) || 0,
        parLevel: Number(body.parLevel) || 0,
        notes: body.notes ?? null,
      };
      const v = await storage.createVariant(payload);
      await audit("add_variant", "item", itemId, `Added size ${size} to "${item.name}" (qty ${v.quantity})`, body.actor);
      res.json(v);
    } catch (e) { handleErr(e, res); }
  });

  app.patch("/api/variants/:id", writeGuard, async (req, res) => {
    try {
      const variant = await storage.getVariant(Number(req.params.id));
      if (!variant) return res.status(404).json({ message: "Size not found." });
      const { actor, itemId: _itemId, ...rest } = req.body ?? {};
      const patch: Partial<InsertItemVariant> = {};
      if (rest.size != null) {
        const size = normSize(rest.size);
        if (!size) return res.status(400).json({ message: "Size is required." });
        // Reject a rename that collides with another size on the same item.
        const siblings = await storage.listVariants(variant.itemId);
        if (siblings.some((v) => v.id !== variant.id && v.size.trim().toLowerCase() === size.toLowerCase()))
          return res.status(409).json({ message: `Size "${size}" already exists for this item.` });
        patch.size = size;
      }
      if (rest.sku !== undefined) patch.sku = rest.sku != null && String(rest.sku).trim() !== "" ? String(rest.sku).trim() : null;
      if (rest.quantity !== undefined) patch.quantity = Math.max(0, Number(rest.quantity) || 0);
      if (rest.parLevel !== undefined) patch.parLevel = Math.max(0, Number(rest.parLevel) || 0);
      if (rest.notes !== undefined) patch.notes = rest.notes ?? null;
      const updated = await storage.updateVariant(variant.id, patch);
      const item = await storage.getItem(variant.itemId);
      const diff = diffDetail(variant, updated, patch);
      await audit("update_variant", "item", variant.itemId, `Updated size ${updated?.size ?? variant.size} on "${item?.name ?? `#${variant.itemId}`}"${diff ? ` — ${diff}` : ""}`, actor);
      res.json(updated);
    } catch (e) { handleErr(e, res); }
  });

  app.delete("/api/variants/:id", writeGuard, async (req, res) => {
    const variant = await storage.getVariant(Number(req.params.id));
    if (!variant) return res.status(404).json({ message: "Size not found." });
    // Block deletion while any ACTIVE assignment still references this size.
    const active = await storage.listActiveAssignments();
    if (active.some((a) => a.itemVariantId === variant.id))
      return res.status(409).json({ message: "Cannot delete: this size is currently issued to one or more officers." });
    await storage.deleteVariant(variant.id);
    const item = await storage.getItem(variant.itemId);
    await audit("delete_variant", "item", variant.itemId, `Removed size ${variant.size} from "${item?.name ?? `#${variant.itemId}`}"`, req.query.actor as string);
    res.json({ ok: true });
  });

  /* --------------------------- RESTOCK --------------------------- */
  // "Add Existing" stock intake. Adds quantity / serials / sizes to an existing
  // item atomically per submission, reusing the same quantity-sync paths as the
  // units and variants routes. Produces a detailed `restock: …` audit entry.
  app.post("/api/items/:id/restock", writeGuard, async (req, res) => {
    // Coerce to a safe positive integer — rejects NaN/Infinity/negatives and
    // caps absurd values so arithmetic can never overflow or poison totals.
    const toAdd = (v: any) => {
      const n = Math.floor(Number(v));
      return Number.isSafeInteger(n) && n > 0 && n <= 1_000_000 ? n : 0;
    };
    try {
      const itemId = Number(req.params.id);
      const item = await storage.getItem(itemId);
      if (!item) return res.status(404).json({ message: "Item not found." });
      const { actor, note } = req.body ?? {};
      const noteStr = note != null && String(note).trim() !== "" ? String(note).trim() : "";
      const notePart = noteStr ? ` — note: ${noteStr}` : "";
      let detail = "";

      if (item.type === "unique") {
        // Serialized intake: accept plain `serials: [...]` or structured
        // `units: [{serialNumber, secondarySerialNumber}]` for dual-serial items.
        const raw: { serialNumber: string; secondarySerialNumber?: string | null }[] =
          Array.isArray(req.body?.units)
            ? req.body.units.map((u: any) => ({ serialNumber: String(u?.serialNumber ?? "").trim(), secondarySerialNumber: u?.secondarySerialNumber != null ? String(u.secondarySerialNumber).trim() : null }))
            : Array.isArray(req.body?.serials)
              ? req.body.serials.map((s: any) => ({ serialNumber: String(s ?? "").trim(), secondarySerialNumber: null }))
              : [];
        const entries = raw.filter((u) => u.serialNumber !== "");
        if (entries.length === 0) return res.status(400).json({ message: "Enter at least one serial number." });
        // No duplicates within this submission (case-insensitive, across both panels).
        const seen = new Set<string>();
        for (const e of entries) {
          for (const s of [e.serialNumber, e.secondarySerialNumber].filter((x): x is string => !!x)) {
            const k = s.toLowerCase();
            if (seen.has(k)) return res.status(400).json({ message: `Duplicate serial "${s}" in this submission.` });
            seen.add(k);
          }
        }
        // Reject serials that already exist for this item (case-insensitive).
        const existing = await storage.listUnitsByItem(itemId);
        const existingSet = new Set<string>();
        for (const u of existing) {
          if (u.serialNumber) existingSet.add(u.serialNumber.toLowerCase());
          if (u.secondarySerialNumber) existingSet.add(u.secondarySerialNumber.toLowerCase());
        }
        for (const e of entries) {
          for (const s of [e.serialNumber, e.secondarySerialNumber].filter((x): x is string => !!x)) {
            if (existingSet.has(s.toLowerCase()))
              return res.status(400).json({ message: `Serial "${s}" already exists for this item.` });
          }
        }
        const labels: string[] = [];
        for (const e of entries) {
          if (item.requiresDualSerial && !e.secondarySerialNumber)
            return res.status(400).json({ message: "Both FP (front panel) and BP (back panel) serials are required." });
          await storage.createUnit({
            itemId,
            serialNumber: e.serialNumber,
            secondarySerialNumber: e.secondarySerialNumber ?? null,
            condition: "NEW",
            location: item.location ?? "",
            acquiredDate: "",
            notes: "",
          });
          labels.push(item.requiresDualSerial && e.secondarySerialNumber ? `FP ${e.serialNumber} / BP ${e.secondarySerialNumber}` : e.serialNumber);
        }
        detail = `restock: added ${labels.length} serial${labels.length === 1 ? "" : "s"} (${labels.join(", ")})`;
      } else if (item.type === "sized") {
        // Per-size additions; create a brand-new size row when it doesn't exist.
        const sizes: { size: string; addQuantity: number }[] = Array.isArray(req.body?.sizes)
          ? req.body.sizes.map((s: any) => ({ size: String(s?.size ?? "").trim(), addQuantity: toAdd(s?.addQuantity) }))
          : [];
        const adds = sizes.filter((s) => s.size !== "" && s.addQuantity > 0);
        if (adds.length === 0) return res.status(400).json({ message: "Enter a positive quantity for at least one size." });
        const existing = await storage.listVariants(itemId);
        const parts: string[] = [];
        for (const a of adds) {
          const match = existing.find((v) => v.size.trim().toLowerCase() === a.size.toLowerCase());
          if (match) {
            const before = match.quantity;
            const after = before + a.addQuantity;
            await storage.updateVariant(match.id, { quantity: after });
            parts.push(`size ${match.size} ${before} → ${after} (+${a.addQuantity})`);
          } else {
            await storage.createVariant({ itemId, size: a.size, sku: null, quantity: a.addQuantity, parLevel: 0, notes: null });
            parts.push(`size ${a.size} 0 → ${a.addQuantity} (+${a.addQuantity})`);
          }
        }
        detail = `restock: ${parts.join(", ")}`;
      } else {
        // Quantity-tracked (consumable / returnable).
        const add = toAdd(req.body?.addQuantity);
        if (add <= 0) return res.status(400).json({ message: "Quantity to add must be a positive integer (max 1,000,000)." });
        const before = item.quantity;
        const after = before + add;
        await storage.updateItem(itemId, { quantity: after });
        detail = `restock: quantity ${before} → ${after} (+${add})`;
      }

      await audit("restock_item", "item", itemId, `Restocked "${item.name}" — ${detail}${notePart}`, actor);
      res.json(await storage.getItem(itemId));
    } catch (e) { handleErr(e, res); }
  });

  /* ----------------------- ASSIGNMENTS / I-R ---------------------- */
  app.get("/api/assignments", async (_req, res) => {
    const list = await storage.listAssignments();
    // Attach the size label for sized assignments so the UI can show it without
    // a per-row variant fetch. Look up each referenced variant once.
    const sizeById = new Map<number, string>();
    for (const id of Array.from(new Set(list.map((a) => a.itemVariantId).filter((v): v is number => v != null)))) {
      const v = await storage.getVariant(id);
      if (v) sizeById.set(id, v.size);
    }
    res.json(list.map((a) => ({ ...a, variantSize: a.itemVariantId != null ? sizeById.get(a.itemVariantId) ?? null : null })));
  });

  // Issue an item to an officer
  app.post("/api/issue", writeGuard, async (req, res) => {
    try {
      const schema = z.object({
        itemId: z.number(), officerId: z.number(), quantity: z.number().min(1).default(1),
        itemUnitId: z.number().nullish(), itemVariantId: z.number().nullish(),
        conditionOut: z.string().optional(), dueDate: z.string().nullish(),
        issuedBy: z.string().optional(), issuedLocation: z.string().optional(),
        signature: z.string().optional(), notes: z.string().optional(),
      });
      const d = schema.parse(req.body);
      const officer = await storage.getOfficer(d.officerId);
      if (!officer) return res.status(404).json({ message: "Officer not found." });

      // #6: issued-by, issued-location and recipient signature are required.
      const missing: string[] = [];
      if (!d.issuedBy?.trim()) missing.push("Issued by");
      if (!d.issuedLocation?.trim()) missing.push("Issued location");
      if (!d.signature?.trim()) missing.push("Recipient signature");
      if (missing.length)
        return res.status(400).json({ message: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required to complete an issuance.` });

      const plan = await planIssue(officer,
        [{ itemId: d.itemId, quantity: d.quantity, itemUnitId: d.itemUnitId, itemVariantId: d.itemVariantId }],
        { dueDate: d.dueDate, signature: d.signature, notes: d.notes, conditionOut: d.conditionOut, issuedBy: d.issuedBy, issuedLocation: d.issuedLocation });
      if (!plan.ok) { const e = plan.errors[0]; return res.status(e.code).json({ message: e.message }); }

      const [a] = await storage.issueBatch(plan);
      for (const u of plan.unitConditionUpdates ?? [])
        await storage.updateUnit(u.id, { condition: u.condition });
      await audit("issue", "assignment", a.id, plan.auditDetails[0], d.issuedBy);
      res.json(a);
    } catch (e) { handleErr(e, res); }
  });

  // Issue multiple items (a cart) to one officer in a single atomic batch.
  // Validation is all-or-nothing: if any line is invalid, nothing is written
  // and every failing line is returned (0-based index into the request lines).
  app.post("/api/issue/batch", writeGuard, async (req, res) => {
    try {
      const schema = z.object({
        officerId: z.number(),
        signature: z.string().optional(),
        dueDate: z.string().nullish(),
        notes: z.string().optional(),
        issuedBy: z.string().optional(),
        issuedLocation: z.string().optional(),
        emailReceipt: z.boolean().optional(),
        lines: z.array(z.object({
          itemId: z.number(),
          quantity: z.number().int().positive(),
          itemUnitId: z.number().nullish(),
          itemVariantId: z.number().nullish(),
          conditionOut: z.string().nullish(),
        })).min(1),
      });
      const d = schema.parse(req.body);
      const officer = await storage.getOfficer(d.officerId);
      if (!officer) return res.status(404).json({ message: "Officer not found." });

      // #6: issued-by, issued-location and recipient signature are required.
      const missing: string[] = [];
      if (!d.issuedBy?.trim()) missing.push("Issued by");
      if (!d.issuedLocation?.trim()) missing.push("Issued location");
      if (!d.signature?.trim()) missing.push("Recipient signature");
      if (missing.length)
        return res.status(400).json({ message: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required to complete an issuance.` });

      const plan = await planIssue(officer, d.lines,
        { dueDate: d.dueDate, signature: d.signature, notes: d.notes, issuedBy: d.issuedBy, issuedLocation: d.issuedLocation });
      if (!plan.ok)
        return res.status(409).json({ message: "Nothing was issued — one or more lines are invalid.", errors: plan.errors.map((e) => ({ index: e.index, message: e.message })) });

      const created = await storage.issueBatch(plan);
      // #9: persist per-line condition changes onto serialized units (issue_batch
      // only sets status/assignedOfficerId, never condition).
      for (const u of plan.unitConditionUpdates ?? [])
        await storage.updateUnit(u.id, { condition: u.condition });
      for (let i = 0; i < created.length; i++)
        await audit("issue", "assignment", created[i].id, plan.auditDetails[i], d.issuedBy);

      // Optional issuance receipt email (#18) — only when requested and the
      // officer has an email on file. Never blocks the issue on email failure.
      let emailed = false;
      if (d.emailReceipt && isValidEmail(officer.email)) {
        try {
          const lines = plan.auditDetails.map((s) => `  • ${s.replace(/ to .*$/, "")}`).join("\n");
          const body = `Hello ${recipientLabel(officer)},\n\nThe following equipment has been issued to you${d.dueDate ? ` (due ${d.dueDate})` : ""}:\n\n${lines}\n\n${d.notes ? `Notes: ${d.notes}\n\n` : ""}Please retain this receipt for your records.\n\n— UFPD Quartermaster`;
          const log = await sendEmail({
            to: officer.email!, subject: `UFPD Quartermaster — Issuance receipt (${created.length} item${created.length === 1 ? "" : "s"})`,
            body, template: "issue_receipt", relatedType: "officer", relatedId: officer.id,
          });
          emailed = log.status !== "failed";
          await audit("email", "officer", officer.id, `Issuance receipt ${log.status} to ${officer.email} (${log.provider})`, d.issuedBy);
        } catch { /* email is best-effort */ }
      }
      res.json({ issued: created.length, assignments: created, emailed });
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
      if (conditionIn != null && conditionIn !== "" && !isValidCondition(conditionIn))
        return res.status(400).json({ message: conditionError });
      const condition = conditionIn ?? "GOOD";

      // Pre-resolve the return branch (sized / serialized / bulk) here, then
      // apply the assignment update + stock restock atomically via one RPC so a
      // partial write can never escape. Branch logic mirrors the prior
      // sequential implementation exactly.
      const plan: ReturnPlan = {
        assignmentId: a.id,
        assignmentPatch: {
          status: "returned", conditionIn: condition, returnedAt: nowISO(),
          returnedBy: returnedBy ?? null, notes: notes ?? a.notes,
        },
        variantDelta: null, unitPatch: null, itemPatch: null, syncItemIds: [],
      };
      if (item && item.type === "sized" && a.itemVariantId) {
        // Sized return: restock the specific size only when the item is
        // configured returnable. Consumable sized items are marked returned but
        // never restocked (mirrors non-sized consumable behavior).
        if ((item.returnBehavior ?? "returnable") === "returnable") {
          const variant = await storage.getVariant(a.itemVariantId);
          if (variant) plan.variantDelta = { id: variant.id, newQty: variant.quantity + a.quantity };
        }
      } else if (item && item.type === "unique" && a.itemUnitId) {
        // Serialized return: flip the specific unit back, then let the item
        // quantity/status re-derive from its units (syncItemIds).
        plan.unitPatch = {
          id: a.itemUnitId,
          status: item.requiresInspection ? "maintenance" : "in_stock",
          assignedOfficerId: null,
          condition,
        };
        plan.syncItemIds = [item.id];
      } else if (item) {
        // Damaged returnable items go to maintenance if inspection required
        const backToStock = item.requiresInspection ? "maintenance" : "in_stock";
        let status = item.type === "unique"
          ? (item.requiresInspection ? "maintenance" : "in_stock")
          : item.status;
        if (item.requiresInspection) status = backToStock;
        plan.itemPatch = { id: item.id, quantity: item.quantity + a.quantity, status, condition };
      }
      await storage.returnAssignment(plan);
      let serialInfo = "";
      if (item?.type === "unique" && a.itemUnitId) {
        const unit = await storage.getUnit(a.itemUnitId);
        if (unit) serialInfo = item.requiresDualSerial && unit.secondarySerialNumber
          ? ` [FP ${unit.serialNumber} / BP ${unit.secondarySerialNumber}]`
          : ` [serial ${unit.serialNumber}]`;
      }
      const byPart = returnedBy ? `, by ${returnedBy}` : "";
      await audit("return", "assignment", a.id,
        `Returned ${a.quantity}x "${item?.name}"${serialInfo} from ${officer ? recipientLabel(officer) : `#${a.officerId}`} — condition in: ${condition}${byPart}`, returnedBy);
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
    const before = await storage.getKit(Number(req.params.id));
    await storage.deleteKit(Number(req.params.id));
    await audit("delete_kit", "kit", Number(req.params.id), `Deleted kit template "${before?.name ?? `#${req.params.id}`}"`, req.query.actor as string);
    res.json({ ok: true });
  });
  app.patch("/api/kits/:id", writeGuard, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const existing = await storage.getKit(id);
      if (!existing) return res.status(404).json({ message: "Not found" });
      const data = insertKitSchema.partial().parse(req.body);
      if (Object.keys(data).length) await storage.updateKit(id, data);
      let linesChanged = false;
      if (req.body.items !== undefined) {
        const lineSchema = z.object({ itemId: z.number(), quantity: z.number().optional() });
        const lines = z.array(lineSchema).parse(req.body.items).map((l) => ({ itemId: l.itemId, quantity: l.quantity ?? 1 }));
        await storage.replaceKitItems(id, lines);
        linesChanged = true;
      }
      const k = await storage.getKit(id);
      const diff = diffDetail(existing, k, data);
      const extra = [diff, linesChanged ? "lines replaced" : ""].filter(Boolean).join(", ");
      await audit("update_kit", "kit", id, `Updated kit template "${k?.name}"${extra ? ` — ${extra}` : ""}`, req.body.actor);
      res.json({ ...k, items: await storage.listKitItems(id) });
    } catch (e) { handleErr(e, res); }
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
      const variantSelections: Record<string, number> = req.body?.variantSelections ?? {};
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

      // Build a write-free plan (aggregated deltas + one assignment per issuable
      // line), deciding skips here, then apply it atomically via one RPC. Running
      // balances mirror the old sequential per-line stock decrements (a kit that
      // lists the same variant/item twice sees the reduced stock on later lines).
      const skipped: string[] = [];
      const plan: KitIssuePlan = { variantDeltas: [], itemDeltas: [], unitIssues: [], assignments: [], syncItemIds: [] };
      const variantRemaining = new Map<number, number>();
      const itemRemaining = new Map<number, number>();
      const syncItemIds = new Set<number>();
      for (const line of lines) {
        const item = await storage.getItem(line.itemId);
        if (!item) continue;
        let itemUnitId: number | null = null;
        let itemVariantId: number | null = null;
        if (item.type === "unique") {
          const unit = unitByItem[item.id];
          plan.unitIssues.push({ id: unit.id, officerId: officer.id });
          syncItemIds.add(item.id);
          itemUnitId = unit.id;
        } else if (item.type === "sized") {
          // Sized kit lines need a per-item size pick; a missing/invalid or
          // out-of-stock pick fails just that line so the rest still issue.
          const chosenId = variantSelections[String(item.id)];
          const variant = chosenId ? await storage.getVariant(Number(chosenId)) : undefined;
          if (!variant || variant.itemId !== item.id) { skipped.push(`${item.name} (no size selected)`); continue; }
          if (!variantRemaining.has(variant.id)) variantRemaining.set(variant.id, variant.quantity);
          const remaining = variantRemaining.get(variant.id)!;
          if (remaining < line.quantity) { skipped.push(`${item.name} size ${variant.size} (insufficient stock)`); continue; }
          variantRemaining.set(variant.id, remaining - line.quantity);
          itemVariantId = variant.id;
        } else {
          if (!itemRemaining.has(item.id)) itemRemaining.set(item.id, item.quantity);
          const remaining = itemRemaining.get(item.id)!;
          if (remaining < line.quantity) { skipped.push(`${item.name} (insufficient stock)`); continue; }
          itemRemaining.set(item.id, remaining - line.quantity);
        }
        plan.assignments.push({
          itemId: item.id, itemUnitId: itemUnitId as any, itemVariantId: itemVariantId as any, officerId: officer.id, quantity: line.quantity, status: "active",
          conditionOut: normalizeCondition(item.condition ?? "NEW"), conditionIn: null as any,
          issuedAt: nowISO(), dueDate: dueDate ?? null as any, returnedAt: null as any,
          issuedBy: issuedBy ?? null as any, returnedBy: null as any,
          signature: signature ?? null as any, notes: notes ?? "Kit issue",
        });
      }
      plan.variantDeltas = Array.from(variantRemaining.entries()).map(([id, newQty]) => ({ id, newQty }));
      plan.itemDeltas = Array.from(itemRemaining.entries()).map(([id, newQty]) => ({ id, newQty, setIssued: false }));
      plan.syncItemIds = Array.from(syncItemIds);
      const results = await storage.issueKit(plan);
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
  // Read-only activity trail. Restricted to roles that oversee operations —
  // admin, quartermaster (Batch 5), supervisor, auditor. Officers are excluded.
  app.get("/api/audit", requireRole("admin", "quartermaster", "supervisor", "auditor"), async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json(await storage.listAudit(limit));
  });

  /* ----------------------------- EMAIL --------------------------- */
  // All email routes are admin/quartermaster only. No provider secrets are ever
  // returned to the client — only the active provider name.
  // Throttle email endpoints: sends can reach real mailboxes once a provider
  // is configured, so cap send-type requests per client IP as an abuse
  // backstop on top of the role/session guard. Read endpoints are untouched.
  const emailSendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 30, // max send-type requests per IP per window
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
    handler: (_req, res) => {
      res.status(429).json({
        message: "Too many email requests. Please wait a few minutes and try again.",
      });
    },
  });

  // Admin-only password reset. Generates a cryptographically secure temporary
  // password, stores only its bcrypt hash, forces a change at next sign-in, and
  // emails the temp password to the user's address on file. The temp password
  // is NEVER returned to the client, logged, or written to the audit trail —
  // it exists in the outbound email only. Rate-limited like other sends.
  app.post("/api/users/:id/reset-password", adminGuard, emailSendLimiter, async (req, res) => {
    const target = await storage.getUser(Number(req.params.id));
    if (!target) return res.status(404).json({ message: "Not found" });
    if (!isValidEmail(target.email)) {
      return res.status(400).json({ message: "This user has no email address on file. Add one before resetting the password." });
    }
    const tempPassword = generateTempPassword();
    await storage.updateUser(target.id, { password: hashPassword(tempPassword), mustChangePassword: true });
    // Force any live sessions for this account to re-authenticate (best effort).
    revokeUserSessions(target.id);
    const body = `Hello ${target.name},\n\nAn administrator has reset your UFPD Quartermaster password.\n\nUsername: ${target.username}\nTemporary password: ${tempPassword}\n\nPlease sign in with this temporary password. You will be required to set a new password immediately.\n\n— UFPD Quartermaster`;
    const log = await sendEmail({
      to: target.email!,
      subject: "UFPD Quartermaster — temporary password",
      body,
      template: "password_reset",
      relatedType: "user",
      relatedId: target.id,
    });
    // Audit records only that a reset occurred — never the password content.
    await audit("reset_password", "user", target.id, `Password reset for ${target.username} (email sent)`, req.body?.actor);
    // Do not echo the temp password; report only the delivery status.
    res.json({ ok: true, status: log.status, provider: log.provider });
  });

  app.get("/api/email/config", writeGuard, async (_req, res) => {
    res.json({ provider: activeProvider() });
  });

  app.get("/api/email/log", writeGuard, async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    res.json(await storage.listEmailLog(limit));
  });

  // Compose + send. The recipient MUST be an email on file for a person or
  // business — free-typed addresses are rejected server-side (mirrors the UI).
  app.post("/api/email/send", writeGuard, emailSendLimiter, async (req, res) => {
    try {
      const schema = z.object({ to: z.string(), subject: z.string().min(1), body: z.string().min(1), actor: z.string().optional() });
      const d = schema.parse(req.body);
      const officers = await storage.listOfficers();
      const match = officers.find((o) => isValidEmail(o.email) && o.email!.trim().toLowerCase() === d.to.trim().toLowerCase());
      if (!match) return res.status(400).json({ message: "Recipient must be a person or business with an email on file." });
      const log = await sendEmail({ to: match.email!, subject: d.subject, body: d.body, template: "manual", relatedType: "officer", relatedId: match.id });
      await audit("email", "officer", match.id, `Email "${d.subject}" ${log.status} to ${match.email} (${log.provider})`, d.actor);
      res.json(log);
    } catch (e) { handleErr(e, res); }
  });

  // Send one overdue-return reminder per officer who has overdue returnable
  // assignments and an email on file. Officers without email are skipped.
  app.post("/api/email/overdue-reminders", writeGuard, emailSendLimiter, async (req, res) => {
    try {
      const actor = req.body?.actor as string | undefined;
      const active = await storage.listActiveAssignments();
      const items = await storage.listItems();
      const officers = await storage.listOfficers();
      const itemById = new Map(items.map((i) => [i.id, i]));
      const officerById = new Map(officers.map((o) => [o.id, o]));
      const now = new Date();

      // Group overdue returnable assignments by officer.
      const byOfficer = new Map<number, string[]>();
      for (const a of active) {
        if (!a.dueDate || new Date(a.dueDate) >= now) continue;
        const item = itemById.get(a.itemId);
        if (item && item.type === "consumable") continue; // consumables aren't returned
        const arr = byOfficer.get(a.officerId) ?? [];
        arr.push(`  • ${a.quantity}× ${item?.name ?? `Item #${a.itemId}`} — due ${a.dueDate}`);
        byOfficer.set(a.officerId, arr);
      }

      let sent = 0; const skipped: string[] = [];
      for (const [officerId, lines] of Array.from(byOfficer)) {
        const officer = officerById.get(officerId);
        if (!officer) continue;
        if (!isValidEmail(officer.email)) { skipped.push(recipientLabel(officer)); continue; }
        const body = `Hello ${recipientLabel(officer)},\n\nOur records show the following equipment is past its return date:\n\n${lines.join("\n")}\n\nPlease return these items to the quartermaster as soon as possible.\n\n— UFPD Quartermaster`;
        const log = await sendEmail({ to: officer.email!, subject: "UFPD Quartermaster — Overdue equipment reminder", body, template: "overdue_reminder", relatedType: "officer", relatedId: officer.id });
        if (log.status !== "failed") sent++;
        await audit("email", "officer", officer.id, `Overdue reminder ${log.status} to ${officer.email} (${log.provider})`, actor);
      }
      res.json({ sent, skipped, officersWithOverdue: byOfficer.size });
    } catch (e) { handleErr(e, res); }
  });

  // Send a low-stock (at/below par) report to a chosen recipient who has an
  // email on file.
  app.post("/api/email/low-stock", writeGuard, emailSendLimiter, async (req, res) => {
    try {
      const schema = z.object({ to: z.string(), actor: z.string().optional() });
      const d = schema.parse(req.body);
      const officers = await storage.listOfficers();
      const recipient = officers.find((o) => isValidEmail(o.email) && o.email!.trim().toLowerCase() === d.to.trim().toLowerCase());
      if (!recipient) return res.status(400).json({ message: "Recipient must be a person or business with an email on file." });

      const items = await storage.listItems();
      const unitCounts = await storage.unitStatusCountsByItem();
      const variantCounts = await storage.variantCountsByItem();
      const low = items
        .map((i) => ({ i, ...computeStock(i, i.type === "unique" ? unitCounts[i.id] : undefined, i.type === "sized" ? variantCounts[i.id] : undefined) }))
        .filter((x) => x.lowStock);

      const lines = low.length
        ? low.map((x) => `  • ${x.i.name} — ${x.onHand} on hand (par ${x.i.parLevel})`).join("\n")
        : "  (No items are at or below their par level.)";
      const body = `Low-stock report as of ${new Date().toLocaleString()}:\n\n${lines}\n\n— UFPD Quartermaster`;
      const log = await sendEmail({ to: recipient.email!, subject: `UFPD Quartermaster — Low-stock report (${low.length} item${low.length === 1 ? "" : "s"})`, body, template: "low_stock", relatedType: "officer", relatedId: recipient.id });
      await audit("email", "officer", recipient.id, `Low-stock report ${log.status} to ${recipient.email} (${log.provider})`, d.actor);
      res.json({ ...log, count: low.length });
    } catch (e) { handleErr(e, res); }
  });

  /* --------------------------- DASHBOARD -------------------------- */
  app.get("/api/dashboard", async (_req, res) => {
    const allItems = await storage.listItems();
    const active = await storage.listActiveAssignments();
    const officers = await storage.listOfficers();
    const today = new Date();
    const in90 = new Date(); in90.setDate(today.getDate() + 90);

    const counts = await storage.unitStatusCountsByItem();
    const variantCounts = await storage.variantCountsByItem();
    const withStock = allItems.map(i => {
      const uc = i.type === "unique" ? counts[i.id] : undefined;
      const vc = i.type === "sized" ? variantCounts[i.id] : undefined;
      return { ...i, ...computeStock(i, uc, vc) };
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
  const status = (e as any)?.status;
  if (typeof status === "number") return res.status(status).json({ message: (e as Error).message });
  console.error(e);
  res.status(500).json({ message: (e as Error).message ?? "Server error" });
}
