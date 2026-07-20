import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp } from "@/lib/app-context";
import { downloadIssueReceipt, downloadReturnReceipt, type IssueReceiptData, type ReturnReceiptData } from "@/lib/receipt";
import { PageHeader, Pill, TypeBadge, EmptyState } from "@/components/bits";
import { fmtDate, fmtDateTime, relativeDays } from "@/lib/format";
import type { Officer, Item, ItemWithStock, Assignment, ItemUnit, ItemVariant } from "@shared/schema";
import { officerSizeForItem } from "@/lib/item-fields";
import { isDualSerialItem } from "@/components/serial-units-dialog";
import { ITEM_CATEGORIES, ITEM_SUBCATEGORIES } from "@/lib/item-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Input as In } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScannerDialog } from "@/components/scanner-dialog";
import { isValidEmail, CONDITIONS, normalizeCondition } from "@shared/validation";
import { useToast } from "@/hooks/use-toast";
import { ArrowUpRight, ArrowDownLeft, Search, PackageCheck, Plus, Trash2, ShoppingCart, ScanLine } from "lucide-react";

/** Parse a scanned value. Accepts "QM:item:<id>", a bare number, or a SKU/serial string. */
function parseScan(raw: string): { id?: number; sku?: string } {
  const t = raw.trim();
  const m = t.match(/^QM:item:(\d+)$/i);
  if (m) return { id: Number(m[1]) };
  if (/^\d+$/.test(t)) return { id: Number(t) };
  return { sku: t };
}

type CartLine = {
  id: string;
  itemId: number;
  itemName: string;
  categoryLabel: string;
  quantity: number;
  itemUnitId?: number;
  unitSerial?: string;
  itemVariantId?: number;
  variantSize?: string;
  // Serialized/sized lines loaded from a kit start unresolved: the user must
  // pick a specific serial or size before the cart can be issued (#13/#14).
  itemType?: string;
  needsSelection?: boolean;
  fromKit?: boolean;
  // Available stock captured at resolve time, for inline over-stock checks.
  availStock?: number;
};

// Kit → cart handoff. The Kits page stashes the chosen kit's lines here and
// navigates to /issue, which drains it on mount (#13/#14).
export type KitCartPayload = { kitName: string; lines: { itemId: number; quantity: number }[] };
// In-memory kit→cart handoff. SPA navigation (wouter) never reloads the page, so a
// module variable is sufficient — and unlike sessionStorage it can't throw inside
// the sandboxed preview iframe.
let kitCartHandoff: KitCartPayload | null = null;
export function setKitCart(p: KitCartPayload) { kitCartHandoff = p; }
export function takeKitCart(): KitCartPayload | null {
  const p = kitCartHandoff;
  kitCartHandoff = null;
  return p;
}

export default function IssueReturn() {
  const { user } = useApp();
  const { toast } = useToast();
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });
  const { data: items } = useQuery<ItemWithStock[]>({ queryKey: ["/api/items"] });
  const { data: assignments } = useQuery<(Assignment & { variantSize?: string | null })[]>({ queryKey: ["/api/assignments"] });

  // issue form state — the current selection being built into a cart line
  const [officerId, setOfficerId] = useState("");
  const [issueCategory, setIssueCategory] = useState("");
  const [issueSubcategory, setIssueSubcategory] = useState("");
  const [itemId, setItemId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState(1);
  // cart-level fields (apply to the whole cart / one signature)
  const [dueDate, setDueDate] = useState("");
  const [signature, setSignature] = useState("");
  const [notes, setNotes] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [issuedLocation, setIssuedLocation] = useState("");
  const [issuing, setIssuing] = useState(false);
  // post-issue / post-return confirmation + receipt (#2)
  const [issueReceipt, setIssueReceipt] = useState<(IssueReceiptData & { count: number }) | null>(null);
  const [returnReceipt, setReturnReceipt] = useState<(ReturnReceiptData & { itemLabel: string }) | null>(null);
  // cart of items to issue together to the selected officer
  const [lines, setLines] = useState<CartLine[]>([]);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  // officer to switch to, pending confirmation while the cart is non-empty
  const [pendingOfficer, setPendingOfficer] = useState<string | null>(null);
  // QR scan-to-cart dialog (#9)
  const [scanOpen, setScanOpen] = useState(false);
  // Email issuance receipt to the officer (#18) — only when they have an email.
  const [emailReceipt, setEmailReceipt] = useState(false);

  // return state
  const [returnFor, setReturnFor] = useState<Assignment | null>(null);
  const [conditionIn, setConditionIn] = useState("GOOD");
  const [returnNote, setReturnNote] = useState("");
  const [returning, setReturning] = useState(false);

  const [q, setQ] = useState("");

  // Sized items keep item.quantity at 0 (stock lives on the variants), so gate
  // availability on onHand which computeStock derives per type.
  const availableItems = useMemo(() => (items ?? []).filter((i) => i.status !== "retired" && i.status !== "maintenance" && (i.type === "sized" ? i.onHand > 0 : i.quantity > 0)), [items]);
  // Cascade derivations are driven by the ACTUAL item data (categories are
  // free-form and mostly arrive via CSV import), not the hardcoded constants.
  // Canonical values from ITEM_CATEGORIES/ITEM_SUBCATEGORIES sort first (in
  // their defined order); any extras follow alphabetically. NO_CATEGORY is a
  // sentinel bucket for items with an empty/null category.
  const NO_CATEGORY = "__none__";
  const matchesCategory = (i: Item, cat: string) => cat === NO_CATEGORY ? !i.category : i.category === cat;
  const availableCategories = useMemo(() => {
    const present = new Set<string>();
    let hasUncategorized = false;
    for (const i of availableItems) {
      if (i.category) present.add(i.category);
      else hasUncategorized = true;
    }
    const canonical = ITEM_CATEGORIES.filter((c) => present.has(c));
    const extras = Array.from(present).filter((c) => !(ITEM_CATEGORIES as readonly string[]).includes(c)).sort((a, b) => a.localeCompare(b));
    const out = [...canonical, ...extras];
    if (hasUncategorized) out.push(NO_CATEGORY);
    return out;
  }, [availableItems]);
  const availableSubcategories = useMemo(() => {
    if (!issueCategory) return [];
    const present = new Set<string>();
    for (const i of availableItems) if (matchesCategory(i, issueCategory) && i.subcategory) present.add(i.subcategory);
    const canon = ITEM_SUBCATEGORIES[issueCategory] ?? [];
    const canonical = canon.filter((s) => present.has(s));
    const extras = Array.from(present).filter((s) => !canon.includes(s)).sort((a, b) => a.localeCompare(b));
    return [...canonical, ...extras];
  }, [availableItems, issueCategory]);
  const filteredItems = useMemo(
    () => availableItems.filter((i) =>
      matchesCategory(i, issueCategory) &&
      (issueSubcategory === "" || issueSubcategory === "all" || i.subcategory === issueSubcategory)),
    [availableItems, issueCategory, issueSubcategory],
  );
  const selectedItem = items?.find((i) => String(i.id) === itemId);
  const isUnique = selectedItem?.type === "unique";
  const isSized = selectedItem?.type === "sized";
  const { data: selectedUnits } = useQuery<ItemUnit[]>({
    queryKey: ["/api/items", Number(itemId), "units"],
    enabled: !!isUnique,
  });
  // Cart-aware availability: whatever is already in the cart is reserved, so
  // subtract it from the serials/sizes/quantities the pickers offer.
  const cartedUnitIds = useMemo(() => new Set(lines.filter((l) => l.itemUnitId).map((l) => l.itemUnitId!)), [lines]);
  const cartedVariantQty = (vid: number) => lines.filter((l) => l.itemVariantId === vid).reduce((s, l) => s + l.quantity, 0);
  const cartedItemQty = (iid: number) => lines.filter((l) => l.itemId === iid && !l.itemUnitId && !l.itemVariantId).reduce((s, l) => s + l.quantity, 0);

  const inStockUnits = useMemo(
    () => (selectedUnits ?? []).filter((u) => u.status === "in_stock" && !cartedUnitIds.has(u.id)),
    [selectedUnits, cartedUnitIds],
  );
  const { data: selectedVariants } = useQuery<ItemVariant[]>({
    queryKey: ["/api/items", Number(itemId), "variants"],
    enabled: !!isSized,
  });
  const inStockVariants = useMemo(() => (selectedVariants ?? []).filter((v) => v.quantity > 0), [selectedVariants]);
  // Sizes still available after cart reservations, with the adjusted count.
  const availableVariants = useMemo(
    () => inStockVariants.map((v) => ({ v, avail: v.quantity - cartedVariantQty(v.id) })).filter((x) => x.avail > 0),
    [inStockVariants, lines],
  );
  const selectedVariant = selectedVariants?.find((v) => String(v.id) === variantId);
  const selectedVariantAvail = selectedVariant ? selectedVariant.quantity - cartedVariantQty(selectedVariant.id) : 0;
  const selectedItemAvail = selectedItem ? ((selectedItem as ItemWithStock).onHand ?? selectedItem.quantity) - cartedItemQty(selectedItem.id) : 0;
  const selectedOfficer = officers?.find((o) => String(o.id) === officerId);

  // Officer-profile auto-suggest: when both a sized item and an officer are
  // chosen, preselect the variant matching the officer's recorded size.
  const suggestedSize = useMemo(
    () => (isSized && selectedItem && selectedOfficer ? officerSizeForItem(selectedItem, selectedOfficer) : null),
    [isSized, selectedItem, selectedOfficer],
  );
  const suggestedInStock = useMemo(
    () => (suggestedSize ? inStockVariants.find((v) => v.size.trim().toLowerCase() === suggestedSize.trim().toLowerCase()) : undefined),
    [suggestedSize, inStockVariants],
  );
  const suggestedOutOfStock = useMemo(
    () => (suggestedSize && !suggestedInStock
      ? (selectedVariants ?? []).find((v) => v.size.trim().toLowerCase() === suggestedSize.trim().toLowerCase())
      : undefined),
    [suggestedSize, suggestedInStock, selectedVariants],
  );
  useEffect(() => {
    if (suggestedInStock && !variantId) setVariantId(String(suggestedInStock.id));
  }, [suggestedInStock]);
  // Default "Issued By" to the logged-in user's display name (editable).
  useEffect(() => {
    if (user?.name && !issuedBy) setIssuedBy(user.name);
  }, [user?.name]);

  // Drain a kit handoff into the cart (#13/#14). Serialized/sized lines land in
  // a "needs selection" state so the user resolves a serial/size before issuing.
  // Waits for items to load so line metadata (name/category/type) is available.
  useEffect(() => {
    if (!items) return;
    const payload = takeKitCart();
    if (!payload) return;
    try {
      const newLines: CartLine[] = [];
      for (const kl of payload.lines) {
        const item = items.find((i) => i.id === kl.itemId);
        if (!item) continue;
        const needsSelection = item.type === "unique" || item.type === "sized";
        newLines.push({
          id: crypto.randomUUID(), itemId: item.id, itemName: item.name,
          categoryLabel: item.category || "Uncategorized", quantity: kl.quantity,
          itemType: item.type, needsSelection, fromKit: true,
        });
      }
      if (newLines.length) {
        setLines(newLines);
        toast({ title: `Loaded kit "${payload.kitName}" into cart`, description: "Pick a serial/size for each highlighted line, then issue." });
      }
    } catch { /* ignore malformed handoff */ }
  }, [items]);
  const unitLabel = (u: ItemUnit, dual = false) =>
    u.secondarySerialNumber
      ? (dual ? `FP ${u.serialNumber} / BP ${u.secondarySerialNumber}` : `${u.serialNumber} / ${u.secondarySerialNumber}`)
      : u.serialNumber;
  const itemName = (id: number) => items?.find((i) => i.id === id)?.name ?? `Item #${id}`;
  const isBiz = (o: { type?: string | null }) => (o.type ?? "person") === "business";
  const recipName = (o: { type?: string | null; firstName: string; lastName: string }) => isBiz(o) ? o.firstName : `${o.firstName} ${o.lastName}`;
  const officerName = (id: number) => { const o = officers?.find((x) => x.id === id); return o ? (isBiz(o) ? o.firstName : `${o.firstName} ${o.lastName} (#${o.badgeNumber})`) : `Officer #${id}`; };

  const active = useMemo(() => {
    const list = (assignments ?? []).filter((a) => a.status === "active");
    const t = q.toLowerCase();
    if (!t) return list;
    return list.filter((a) => itemName(a.itemId).toLowerCase().includes(t) || officerName(a.officerId).toLowerCase().includes(t));
  }, [assignments, q, items, officers]);

  // Reset only the item pickers; officer + category/subcategory are kept so the
  // user can quickly add several items from the same area to the cart.
  function resetItemPickers() {
    setItemId(""); setUnitId(""); setVariantId(""); setQty(1);
  }

  function addToCart() {
    if (!officerId || !itemId || !selectedItem) return toast({ title: "Select an officer and item", variant: "destructive" });
    const categoryLabel = selectedItem.category || "Uncategorized";

    if (isUnique) {
      if (inStockUnits.length === 0)
        return toast({ title: "No serial in stock", description: "Add an available unit on the Inventory page first.", variant: "destructive" });
      if (!unitId) return toast({ title: "Select a serial/unit to issue", variant: "destructive" });
      const u = inStockUnits.find((x) => String(x.id) === unitId);
      setLines((prev) => [...prev, {
        id: crypto.randomUUID(), itemId: selectedItem.id, itemName: selectedItem.name, categoryLabel,
        quantity: 1, itemUnitId: Number(unitId), unitSerial: u ? unitLabel(u, isDualSerialItem(selectedItem)) : undefined,
        itemType: selectedItem.type, availStock: 1,
      }]);
    } else if (isSized) {
      if (availableVariants.length === 0)
        return toast({ title: "No size in stock", description: "Add stock for a size on the Inventory page first.", variant: "destructive" });
      if (!variantId) return toast({ title: "Select a size to issue", variant: "destructive" });
      const n = Number(qty) || 1;
      if (n > selectedVariantAvail)
        return toast({ title: `Only ${selectedVariantAvail} of that size left`, description: "Adjust the quantity or add stock.", variant: "destructive" });
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.itemId === selectedItem.id && l.itemVariantId === Number(variantId) && !l.itemUnitId);
        if (idx >= 0) { const c = [...prev]; c[idx] = { ...c[idx], quantity: c[idx].quantity + n }; return c; }
        return [...prev, {
          id: crypto.randomUUID(), itemId: selectedItem.id, itemName: selectedItem.name, categoryLabel,
          quantity: n, itemVariantId: Number(variantId), variantSize: selectedVariant?.size, itemType: selectedItem.type, availStock: selectedVariantAvail,
        }];
      });
    } else {
      const n = Number(qty) || 1;
      if (n > selectedItemAvail)
        return toast({ title: `Only ${selectedItemAvail} available`, description: "Adjust the quantity or add stock.", variant: "destructive" });
      setLines((prev) => {
        const idx = prev.findIndex((l) => l.itemId === selectedItem.id && !l.itemVariantId && !l.itemUnitId);
        if (idx >= 0) { const c = [...prev]; c[idx] = { ...c[idx], quantity: c[idx].quantity + n }; return c; }
        return [...prev, { id: crypto.randomUUID(), itemId: selectedItem.id, itemName: selectedItem.name, categoryLabel, quantity: n, itemType: selectedItem.type, availStock: selectedItemAvail }];
      });
    }
    setLineErrors({});
    resetItemPickers();
  }

  // Add a specific serialized unit to the cart (from a scanned unit serial).
  // Respects availability: the unit must be in stock and not already carted.
  function addScannedUnit(item: ItemWithStock, unit: ItemUnit) {
    if (unit.status !== "in_stock")
      return toast({ title: "Serial not available", description: `${unit.serialNumber} is ${unit.status.replace(/_/g, " ")}.`, variant: "destructive" });
    if (cartedUnitIds.has(unit.id))
      return toast({ title: "Already in cart", description: `Serial ${unit.serialNumber} is already in the cart.`, variant: "destructive" });
    const label = unitLabel(unit, isDualSerialItem(item));
    setLines((prev) => [...prev, {
      id: crypto.randomUUID(), itemId: item.id, itemName: item.name, categoryLabel: item.category || "Uncategorized",
      quantity: 1, itemUnitId: unit.id, unitSerial: label, itemType: item.type, availStock: 1,
    }]);
    setLineErrors({});
    toast({ title: "Added to cart", description: `${item.name} · ${label}` });
  }

  // Add an item-level scan to the cart. Serialized/sized items land in a
  // "needs selection" state (the scanned code doesn't name a serial/size);
  // consumable/standard items add one unit, respecting available stock.
  function addScannedItem(item: ItemWithStock) {
    if (item.status === "retired" || item.status === "maintenance")
      return toast({ title: "Item unavailable", description: `${item.name} is ${item.status}.`, variant: "destructive" });
    if (item.type === "unique" || item.type === "sized") {
      setLines((prev) => [...prev, {
        id: crypto.randomUUID(), itemId: item.id, itemName: item.name, categoryLabel: item.category || "Uncategorized",
        quantity: 1, itemType: item.type, needsSelection: true,
      }]);
      setLineErrors({});
      return toast({ title: "Added to cart", description: `${item.name} — pick a ${item.type === "unique" ? "serial" : "size"} in the cart.` });
    }
    const avail = (item.onHand ?? item.quantity) - cartedItemQty(item.id);
    if (avail < 1)
      return toast({ title: "Out of stock", description: `No more ${item.name} available to add.`, variant: "destructive" });
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id && !l.itemVariantId && !l.itemUnitId);
      if (idx >= 0) { const c = [...prev]; c[idx] = { ...c[idx], quantity: c[idx].quantity + 1 }; return c; }
      return [...prev, { id: crypto.randomUUID(), itemId: item.id, itemName: item.name, categoryLabel: item.category || "Uncategorized", quantity: 1, itemType: item.type, availStock: avail }];
    });
    setLineErrors({});
    toast({ title: "Added to cart", description: item.name });
  }

  // Resolve a scanned code and add it to the cart (#9). Tries an item-level
  // match first (QM:item:<id>, bare id, SKU, or item serial), then falls back to
  // matching a serialized unit's serial across the unique items.
  async function handleScan(raw: string) {
    if (!officerId) return toast({ title: "Select an officer first", description: "Choose who the items are for before scanning.", variant: "destructive" });
    const list = items ?? [];
    const { id, sku } = parseScan(raw);
    let item: ItemWithStock | undefined;
    if (id != null) item = list.find((i) => i.id === id);
    if (!item && sku) {
      const s = sku.toLowerCase();
      item = list.find((i) => (i.sku ?? "").toLowerCase() === s || (i.serialNumber ?? "").toLowerCase() === s);
    }
    if (item) return addScannedItem(item);

    if (sku) {
      const needle = sku.toLowerCase();
      for (const uniq of list.filter((i) => i.type === "unique")) {
        try {
          const units = await queryClient.fetchQuery<ItemUnit[]>({ queryKey: ["/api/items", uniq.id, "units"] });
          const unit = (units ?? []).find((u) =>
            (u.serialNumber ?? "").toLowerCase() === needle || (u.secondarySerialNumber ?? "").toLowerCase() === needle);
          if (unit) return addScannedUnit(uniq, unit);
        } catch { /* skip items whose units can't be fetched */ }
      }
    }
    toast({ title: "No match", description: `Nothing matched "${raw}".`, variant: "destructive" });
  }

  function removeFromCart(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
    setLineErrors((prev) => { const c = { ...prev }; delete c[id]; return c; });
  }

  // Apply a resolved serial/size selection to a kit-loaded cart line (#13/#14).
  function resolveLine(id: string, patch: Partial<CartLine>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch, needsSelection: false } : l)));
  }

  // Change the quantity of a cart line (sized/consumable only).
  function setLineQty(id: string, qty: number) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, quantity: Math.max(1, qty) } : l)));
  }

  // Pre-formatted serial(s) for a line — "FP … / BP …" for dual-serial units.
  const serialForLine = (l: CartLine): string | undefined => {
    if (!l.unitSerial) return undefined;
    const item = items?.find((i) => i.id === l.itemId);
    if (item && isDualSerialItem(item) && l.unitSerial.includes(" / ") && !l.unitSerial.startsWith("FP ")) {
      const [fp, bp] = l.unitSerial.split(" / ");
      return `FP ${fp} / BP ${bp}`;
    }
    return l.unitSerial;
  };

  // Inline cart validation (#13/#14): unresolved kit lines, duplicate serials,
  // and over-stock. The server 409 remains the all-or-nothing backstop.
  const lineIssues = useMemo(() => {
    const out: Record<string, string> = {};
    const consumableByItem = new Map<number, number>();
    const sizedByVariant = new Map<number, number>();
    const unitLines = new Map<number, string[]>();
    for (const l of lines) {
      if (l.needsSelection) { out[l.id] = "Pick a serial/size to continue"; continue; }
      if (l.itemUnitId) {
        const arr = unitLines.get(l.itemUnitId) ?? []; arr.push(l.id); unitLines.set(l.itemUnitId, arr);
      } else if (l.itemVariantId) {
        sizedByVariant.set(l.itemVariantId, (sizedByVariant.get(l.itemVariantId) ?? 0) + l.quantity);
      } else {
        consumableByItem.set(l.itemId, (consumableByItem.get(l.itemId) ?? 0) + l.quantity);
      }
    }
    for (const [itemId, qty] of Array.from(consumableByItem)) {
      const item = items?.find((i) => i.id === itemId);
      const avail = item ? item.onHand : 0;
      if (qty > avail) for (const l of lines.filter((x) => x.itemId === itemId && !x.itemVariantId && !x.itemUnitId)) out[l.id] = `Only ${avail} in stock`;
    }
    for (const [variantId, qty] of Array.from(sizedByVariant)) {
      const relevant = lines.filter((x) => x.itemVariantId === variantId);
      const avail = relevant.find((r) => r.availStock != null)?.availStock ?? Infinity;
      if (qty > avail) for (const l of relevant) out[l.id] = `Only ${avail} of that size in stock`;
    }
    for (const [, ids] of Array.from(unitLines)) if (ids.length > 1) for (const id of ids) out[id] = "Duplicate serial in cart";
    return out;
  }, [lines, items]);
  const cartValid = lines.length > 0 && Object.keys(lineIssues).length === 0;

  // Map a 409 batch response ({ errors: [{ index, message }] }) back onto cart
  // rows by their 0-based position in the submitted lines array.
  function parseBatchError(err: any): Record<string, string> | null {
    const stripped = String(err?.message ?? "").replace(/^\d+:\s*/, "").trim();
    try {
      const parsed = JSON.parse(stripped);
      if (Array.isArray(parsed?.errors)) {
        const map: Record<string, string> = {};
        for (const e of parsed.errors) { const l = lines[e.index]; if (l) map[l.id] = e.message; }
        return map;
      }
    } catch { /* not a structured batch error */ }
    return null;
  }

  async function issueCart() {
    if (!officerId) return toast({ title: "Select an officer", variant: "destructive" });
    if (lines.length === 0) return;
    setIssuing(true);
    try {
      const wantsReceipt = emailReceipt && isValidEmail(selectedOfficer?.email);
      const resp = await apiRequest("POST", "/api/issue/batch", {
        officerId: Number(officerId), signature, dueDate: dueDate || null,
        notes: notes || undefined, issuedBy: issuedBy || user?.name,
        issuedLocation: issuedLocation || undefined,
        emailReceipt: wantsReceipt,
        lines: lines.map((l) => ({
          itemId: l.itemId, quantity: l.quantity,
          itemUnitId: l.itemUnitId ?? null, itemVariantId: l.itemVariantId ?? null,
        })),
      });
      invalidateAll();
      Array.from(new Set(lines.map((l) => l.itemId))).forEach((id) => {
        queryClient.invalidateQueries({ queryKey: ["/api/items", id, "units"] });
        queryClient.invalidateQueries({ queryKey: ["/api/items", id, "variants"] });
      });
      const n = lines.length;
      const who = selectedOfficer ? recipName(selectedOfficer) : "officer";
      // Build the issue receipt from the cart before it is cleared (#2).
      if (selectedOfficer) {
        setIssueReceipt({
          count: n,
          timestamp: fmtDateTime(new Date().toISOString()),
          issuedAt: new Date().toISOString(),
          officerName: recipName(selectedOfficer),
          badgeNumber: selectedOfficer.badgeNumber,
          issuedBy: issuedBy || user?.name || null,
          issuedLocation: issuedLocation || null,
          dueDate: dueDate ? fmtDate(dueDate) : null,
          signature: signature || null,
          lines: lines.map((l) => {
            const item = items?.find((i) => i.id === l.itemId);
            return {
              itemName: l.itemName,
              category: l.categoryLabel,
              sizeOrVariant: l.variantSize ?? null,
              serials: serialForLine(l) ?? null,
              quantity: l.quantity,
              condition: item?.condition ?? null,
            };
          }),
        });
      }
      let receiptNote: string | undefined;
      if (wantsReceipt) {
        try { receiptNote = (await resp.clone().json())?.emailed ? "Receipt emailed to officer." : "Receipt recorded (log mode)."; } catch { /* ignore */ }
      }
      toast({ title: `Issued ${n} item${n === 1 ? "" : "s"} to ${who}`, description: receiptNote });
      setLines([]); setLineErrors({}); setSignature(""); setNotes(""); setDueDate(""); setEmailReceipt(false);
      resetItemPickers();
    } catch (e: any) {
      const mapped = parseBatchError(e);
      if (mapped) { setLineErrors(mapped); toast({ title: "Nothing was issued — fix the highlighted lines", variant: "destructive" }); }
      else toast({ title: "Issue failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setIssuing(false); }
  }

  // Switching officers empties the cart (a cart belongs to one officer), so
  // confirm first when there is anything to lose.
  function requestOfficerChange(next: string) {
    if (next === officerId) return;
    if (lines.length > 0) { setPendingOfficer(next); return; }
    setOfficerId(next);
  }

  async function doReturn() {
    if (!returnFor) return;
    setReturning(true);
    const a = returnFor;
    try {
      await apiRequest("POST", `/api/return/${a.id}`, { conditionIn, returnedBy: user?.name, notes: returnNote });
      // Resolve the officer + serial(s) for the return receipt (#2) before the
      // assignment leaves the active list.
      const item = items?.find((i) => i.id === a.itemId);
      const officer = officers?.find((o) => o.id === a.officerId);
      let serials: string | null = null;
      if (a.itemUnitId && item) {
        try {
          const units = (await (await apiRequest("GET", `/api/items/${a.itemId}/units`)).json()) as ItemUnit[];
          const u = units.find((x) => x.id === a.itemUnitId);
          if (u) serials = unitLabel(u, isDualSerialItem(item));
        } catch { /* serial is best-effort */ }
      }
      const itemLabel = `${item?.name ?? itemName(a.itemId)}${(a as any).variantSize ? ` · ${(a as any).variantSize}` : ""}`;
      setReturnReceipt({
        itemLabel,
        timestamp: fmtDateTime(new Date().toISOString()),
        officerName: officer ? recipName(officer) : "Officer",
        badgeNumber: officer?.badgeNumber ?? String(a.officerId),
        returnedBy: user?.name ?? null,
        conditionIn,
        lines: [{
          itemName: item?.name ?? itemName(a.itemId),
          category: item?.category ?? null,
          sizeOrVariant: (a as any).variantSize ?? null,
          serials,
          quantity: a.quantity,
          condition: conditionIn,
        }],
      });
      invalidateAll();
      toast({ title: "Item returned" });
      setReturnFor(null); setReturnNote(""); setConditionIn("GOOD");
    } catch (e: any) {
      toast({ title: "Return failed", description: e.message, variant: "destructive" });
    } finally { setReturning(false); }
  }

  function invalidateAll() {
    ["/api/assignments", "/api/items", "/api/officers", "/api/dashboard"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  }

  return (
    <div>
      <PageHeader title="Issue & Return" subtitle="Check equipment out to personnel and process returns" />

      <Tabs defaultValue="issue">
        <TabsList>
          <TabsTrigger value="issue" data-testid="tab-issue"><ArrowUpRight className="mr-1.5 h-4 w-4" /> Issue</TabsTrigger>
          <TabsTrigger value="return" data-testid="tab-return"><ArrowDownLeft className="mr-1.5 h-4 w-4" /> Return ({active.length})</TabsTrigger>
        </TabsList>

        {/* ISSUE */}
        <TabsContent value="issue" className="mt-4">
          <Card className="max-w-xl p-5">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Issue To</Label>
                <Select value={officerId} onValueChange={requestOfficerChange}>
                  <SelectTrigger data-testid="select-officer"><SelectValue placeholder="Select recipient…" /></SelectTrigger>
                  <SelectContent>
                    {officers?.filter((o) => o.status === "active").map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>
                        {isBiz(o) ? `${o.firstName} (Business)` : `${o.lastName}, ${o.firstName} · #${o.badgeNumber}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Item</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={issueCategory} onValueChange={(v) => { setIssueCategory(v); setIssueSubcategory(""); setItemId(""); setUnitId(""); setVariantId(""); setQty(1); }}>
                    <SelectTrigger data-testid="select-issue-category"><SelectValue placeholder="Category…" /></SelectTrigger>
                    <SelectContent>
                      {availableCategories.map((c) => <SelectItem key={c} value={c}>{c === NO_CATEGORY ? "Uncategorized" : c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {issueCategory && availableSubcategories.length > 0 && (
                    <Select value={issueSubcategory} onValueChange={(v) => { setIssueSubcategory(v); setItemId(""); setUnitId(""); setVariantId(""); setQty(1); }}>
                      <SelectTrigger data-testid="select-issue-subcategory"><SelectValue placeholder="Subcategory…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {availableSubcategories.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <Select value={itemId} onValueChange={(v) => { setItemId(v); setUnitId(""); setVariantId(""); setQty(1); }} disabled={!issueCategory}>
                  <SelectTrigger data-testid="select-item"><SelectValue placeholder={issueCategory ? "Select item in stock…" : "Select category first…"} /></SelectTrigger>
                  <SelectContent>
                    {filteredItems.map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.name}{i.type !== "sized" && i.size ? ` (${i.size})` : ""} — {i.type === "sized" ? i.onHand : i.quantity} avail
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedItem && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <TypeBadge type={selectedItem.type} />
                    <Pill tone="gray">{selectedItem.type === "sized" ? selectedItem.onHand : selectedItem.quantity} in stock</Pill>
                    {selectedItem.location && <Pill tone="gray">{selectedItem.location}</Pill>}
                    {selectedItem.requiresInspection && <Pill tone="amber">inspection on return</Pill>}
                  </div>
                )}
              </div>

              {isUnique && (
                <div className="space-y-1.5">
                  <Label>{isDualSerialItem(selectedItem!) ? "Vest (panel serials)" : "Serial / Unit"}</Label>
                  {inStockUnits.length === 0 ? (
                    <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive" data-testid="text-no-units">
                      No available units in stock. Add a serialized unit on the Inventory page before issuing.
                    </p>
                  ) : (
                    <Select value={unitId} onValueChange={setUnitId}>
                      <SelectTrigger data-testid="select-unit"><SelectValue placeholder="Select serial to issue…" /></SelectTrigger>
                      <SelectContent>
                        {inStockUnits.map((u) => <SelectItem key={u.id} value={String(u.id)}>{unitLabel(u, isDualSerialItem(selectedItem!))}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {isSized && (
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  {availableVariants.length === 0 ? (
                    <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive" data-testid="text-no-sizes">
                      No sizes in stock. Add stock for a size on the Inventory page before issuing.
                    </p>
                  ) : (
                    <Select value={variantId} onValueChange={(v) => { setVariantId(v); setQty(1); }}>
                      <SelectTrigger data-testid="select-issue-size"><SelectValue placeholder="Select size to issue…" /></SelectTrigger>
                      <SelectContent>
                        {availableVariants.map(({ v, avail }) => <SelectItem key={v.id} value={String(v.id)}>{v.size} — {avail} avail</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {suggestedInStock && (
                    <p className="text-xs text-muted-foreground" data-testid="text-size-suggested">Auto-selected from profile ({suggestedInStock.size})</p>
                  )}
                  {suggestedOutOfStock && (
                    <p className="text-xs text-chart-3" data-testid="text-size-oos">Officer wears {suggestedOutOfStock.size} — out of stock</p>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input type="number" min={1} max={selectedItem?.type === "unique" ? 1 : isSized ? Math.max(selectedVariantAvail, 1) : Math.max(selectedItemAvail, 1)}
                  value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={selectedItem?.type === "unique"} data-testid="input-issue-qty" />
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={addToCart} disabled={!itemId} data-testid="button-add-to-cart">
                  <Plus className="mr-1.5 h-4 w-4" /> Add to Cart
                </Button>
                <Button variant="outline" onClick={() => setScanOpen(true)} disabled={!officerId} data-testid="button-scan-to-cart">
                  <ScanLine className="mr-1.5 h-4 w-4" /> Scan item
                </Button>
              </div>
            </div>
          </Card>

          {/* Cart */}
          <Card className="mt-4 max-w-xl p-5" data-testid="section-cart">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <ShoppingCart className="h-4 w-4" /> Cart
              </h3>
              <span className="text-xs text-muted-foreground">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
            </div>

            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Cart is empty</p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {lines.map((l) => {
                  const err = lineErrors[l.id] || lineIssues[l.id];
                  return (
                    <li key={l.id} className={`px-3 py-2.5 ${err ? "border-l-2 border-l-destructive bg-destructive/5" : l.needsSelection ? "border-l-2 border-l-chart-3 bg-chart-3/5" : ""}`} data-testid={`row-cart-${l.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {l.quantity}× {l.itemName}
                            {l.unitSerial ? ` · ${l.unitSerial}` : l.variantSize ? ` · ${l.variantSize}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {l.categoryLabel}{l.fromKit ? " · from kit" : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {(l.itemType === "sized" || l.itemType === "consumable") && !l.needsSelection && (
                            <Input
                              type="number" min={1}
                              className="h-7 w-16"
                              value={l.quantity}
                              onChange={(e) => setLineQty(l.id, Number(e.target.value))}
                              data-testid={`input-cart-qty-${l.id}`}
                            />
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeFromCart(l.id)} data-testid={`button-remove-cart-${l.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {l.needsSelection && <CartLineResolver line={l} onResolve={resolveLine} />}
                      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <Label>Issued by (optional)</Label>
                <Input placeholder="Who is issuing these items" value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} data-testid="input-issued-by" />
              </div>
              <div className="space-y-1.5">
                <Label>Issued location (optional)</Label>
                <Input placeholder="Given in person, locker #, front desk…" value={issuedLocation} onChange={(e) => setIssuedLocation(e.target.value)} data-testid="input-issued-location" />
              </div>
              <div className="space-y-1.5">
                <Label>Due date (optional)</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-due-date" />
              </div>
              <div className="space-y-1.5">
                <Label>Recipient signature / acknowledgement</Label>
                <Input placeholder="Type full name to acknowledge receipt" value={signature} onChange={(e) => setSignature(e.target.value)} data-testid="input-signature" />
              </div>
              <div className="space-y-1.5">
                <Label>Notes (optional)</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <label className={`flex items-center gap-2 text-sm ${selectedOfficer && !isValidEmail(selectedOfficer.email) ? "text-muted-foreground" : ""}`}>
                <Checkbox
                  checked={emailReceipt}
                  disabled={!selectedOfficer || !isValidEmail(selectedOfficer.email)}
                  onCheckedChange={(v) => setEmailReceipt(!!v)}
                  data-testid="checkbox-email-receipt"
                />
                Email receipt to officer
                {selectedOfficer && !isValidEmail(selectedOfficer.email) && <span className="text-xs">(no email on file)</span>}
              </label>
              <Button className="w-full" onClick={issueCart} disabled={issuing || !cartValid} data-testid="button-issue-cart">
                <PackageCheck className="mr-1.5 h-4 w-4" /> {issuing ? "Issuing…" : `Issue Cart (${lines.length} item${lines.length === 1 ? "" : "s"})`}
              </Button>
            </div>
          </Card>
        </TabsContent>

        {/* RETURN */}
        <TabsContent value="return" className="mt-4">
          <Card className="mb-4 p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search issued items or officers…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-issued" />
            </div>
          </Card>

          {active.length === 0 ? <EmptyState title="Nothing currently issued" /> : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-border">
                {active.map((a) => {
                  const overdue = a.dueDate && new Date(a.dueDate) < new Date();
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`row-assignment-${a.id}`}>
                      <div className="min-w-0">
                        <p className="font-medium leading-tight">{a.quantity}× {itemName(a.itemId)}{a.variantSize ? ` · ${a.variantSize}` : ""}</p>
                        <p className="text-xs text-muted-foreground">
                          {officerName(a.officerId)} · issued {fmtDate(a.issuedAt)}{a.dueDate ? ` · due ${fmtDate(a.dueDate)}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {a.dueDate && <Pill tone={overdue ? "red" : "gray"}>{relativeDays(a.dueDate)}</Pill>}
                        <Button size="sm" variant="outline" onClick={() => setReturnFor(a)} data-testid={`button-return-${a.id}`}>
                          <ArrowDownLeft className="mr-1 h-4 w-4" /> Return
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* QR scan-to-cart (#9) */}
      <ScannerDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onScan={handleScan}
        title="Scan to cart"
        description="Scan an item QR code or a serialized unit to add it to the current cart. Keep scanning to add more."
      />

      {/* Officer switch confirm — a cart belongs to one officer */}
      <AlertDialog open={pendingOfficer !== null} onOpenChange={(o) => !o && setPendingOfficer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch officers?</AlertDialogTitle>
            <AlertDialogDescription>Switching officers clears the cart. The {lines.length} item{lines.length === 1 ? "" : "s"} you added will be removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingOfficer(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-officer-switch"
              onClick={() => {
                if (pendingOfficer !== null) setOfficerId(pendingOfficer);
                setLines([]); setLineErrors({}); resetItemPickers();
                setPendingOfficer(null);
              }}
            >Switch &amp; clear cart</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return dialog */}
      <Dialog open={!!returnFor} onOpenChange={(o) => !o && setReturnFor(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Process Return</DialogTitle>
            <DialogDescription>
              {returnFor && `${itemName(returnFor.itemId)} from ${officerName(returnFor.officerId)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Returned condition</Label>
              <Select value={conditionIn} onValueChange={setConditionIn}>
                <SelectTrigger data-testid="select-condition"><SelectValue /></SelectTrigger>
                <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={returnNote} onChange={(e) => setReturnNote(e.target.value)} />
            </div>
            {(() => {
              const it = returnFor && items?.find((i) => i.id === returnFor.itemId);
              return it?.requiresInspection ? <p className="rounded-md bg-chart-3/12 p-2.5 text-xs text-foreground">This item requires inspection — it will be held in Maintenance until cleared.</p> : null;
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnFor(null)}>Cancel</Button>
            <Button onClick={doReturn} disabled={returning} data-testid="button-confirm-return">{returning ? "Processing…" : "Confirm Return"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue confirmation + receipt (#2) */}
      <Dialog open={!!issueReceipt} onOpenChange={(o) => !o && setIssueReceipt(null)}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-issue-receipt">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-primary" /> Issue complete</DialogTitle>
            <DialogDescription>
              {issueReceipt && `${issueReceipt.count} item${issueReceipt.count === 1 ? "" : "s"} issued to ${issueReceipt.officerName}${issueReceipt.badgeNumber ? ` (#${issueReceipt.badgeNumber})` : ""}.`}
            </DialogDescription>
          </DialogHeader>
          {issueReceipt && (
            <ul className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-3 text-sm">
              {issueReceipt.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">{l.quantity}× {l.itemName}{l.sizeOrVariant ? ` · ${l.sizeOrVariant}` : ""}{l.serials ? ` · ${l.serials}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueReceipt(null)}>Close</Button>
            <Button onClick={() => issueReceipt && downloadIssueReceipt(issueReceipt)} data-testid="button-download-issue-receipt">Download Receipt (PDF)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return confirmation + receipt (#2) */}
      <Dialog open={!!returnReceipt} onOpenChange={(o) => !o && setReturnReceipt(null)}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-return-receipt">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ArrowDownLeft className="h-5 w-5 text-primary" /> Return complete</DialogTitle>
            <DialogDescription>
              {returnReceipt && `${returnReceipt.itemLabel} returned from ${returnReceipt.officerName}${returnReceipt.badgeNumber ? ` (#${returnReceipt.badgeNumber})` : ""} — condition ${returnReceipt.conditionIn}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnReceipt(null)}>Close</Button>
            <Button onClick={() => returnReceipt && downloadReturnReceipt(returnReceipt)} data-testid="button-download-return-receipt">Download Receipt (PDF)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Inline serial/size picker for kit-loaded cart lines that need resolution
// before the cart can be issued (#13/#14).
function CartLineResolver({ line, onResolve }: { line: CartLine; onResolve: (id: string, patch: Partial<CartLine>) => void }) {
  const isUnique = line.itemType === "unique";
  const { data: units } = useQuery<ItemUnit[]>({ queryKey: ["/api/items", line.itemId, "units"], enabled: isUnique });
  const { data: variants } = useQuery<ItemVariant[]>({ queryKey: ["/api/items", line.itemId, "variants"], enabled: !isUnique });
  const { data: items } = useQuery<ItemWithStock[]>({ queryKey: ["/api/items"] });
  const item = items?.find((i) => i.id === line.itemId);
  const dual = item ? isDualSerialItem(item) : false;
  const inStock = (units ?? []).filter((u) => u.status === "in_stock");
  const inStockVariants = (variants ?? []).filter((v) => v.quantity > 0);

  if (isUnique) {
    return (
      <div className="mt-2">
        {inStock.length === 0 ? (
          <p className="text-xs text-destructive">No serial in stock</p>
        ) : (
          <Select onValueChange={(v) => {
            const u = inStock.find((x) => String(x.id) === v);
            if (u) onResolve(line.id, {
              itemUnitId: u.id,
              unitSerial: dual && u.secondarySerialNumber ? `FP ${u.serialNumber} / BP ${u.secondarySerialNumber}` : u.secondarySerialNumber ? `${u.serialNumber} / ${u.secondarySerialNumber}` : u.serialNumber,
              availStock: 1,
            });
          }}>
            <SelectTrigger className="h-8" data-testid={`select-resolve-serial-${line.id}`}><SelectValue placeholder="Pick a serial…" /></SelectTrigger>
            <SelectContent>
              {inStock.map((u) => <SelectItem key={u.id} value={String(u.id)}>{dual && u.secondarySerialNumber ? `FP ${u.serialNumber} / BP ${u.secondarySerialNumber}` : u.serialNumber}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {inStockVariants.length === 0 ? (
        <p className="text-xs text-destructive">No size in stock</p>
      ) : (
        <Select onValueChange={(v) => {
          const va = inStockVariants.find((x) => String(x.id) === v);
          if (va) onResolve(line.id, { itemVariantId: va.id, variantSize: va.size, availStock: va.quantity });
        }}>
          <SelectTrigger className="h-8" data-testid={`select-resolve-size-${line.id}`}><SelectValue placeholder="Pick a size…" /></SelectTrigger>
          <SelectContent>
            {inStockVariants.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.size} — {v.quantity} avail</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
