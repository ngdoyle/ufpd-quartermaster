import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp } from "@/lib/app-context";
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
import { Input as In } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ArrowUpRight, ArrowDownLeft, Search, PackageCheck } from "lucide-react";

export default function IssueReturn() {
  const { user } = useApp();
  const { toast } = useToast();
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });
  const { data: items } = useQuery<ItemWithStock[]>({ queryKey: ["/api/items"] });
  const { data: assignments } = useQuery<(Assignment & { variantSize?: string | null })[]>({ queryKey: ["/api/assignments"] });

  // issue form state
  const [officerId, setOfficerId] = useState("");
  const [issueCategory, setIssueCategory] = useState("");
  const [issueSubcategory, setIssueSubcategory] = useState("");
  const [itemId, setItemId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [qty, setQty] = useState(1);
  const [dueDate, setDueDate] = useState("");
  const [signature, setSignature] = useState("");
  const [notes, setNotes] = useState("");
  const [issuing, setIssuing] = useState(false);

  // return state
  const [returnFor, setReturnFor] = useState<Assignment | null>(null);
  const [conditionIn, setConditionIn] = useState("Good");
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
  const inStockUnits = useMemo(() => (selectedUnits ?? []).filter((u) => u.status === "in_stock"), [selectedUnits]);
  const { data: selectedVariants } = useQuery<ItemVariant[]>({
    queryKey: ["/api/items", Number(itemId), "variants"],
    enabled: !!isSized,
  });
  const inStockVariants = useMemo(() => (selectedVariants ?? []).filter((v) => v.quantity > 0), [selectedVariants]);
  const selectedVariant = selectedVariants?.find((v) => String(v.id) === variantId);
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
  const unitLabel = (u: ItemUnit) =>
    u.secondarySerialNumber ? `${u.serialNumber} / ${u.secondarySerialNumber}` : u.serialNumber;
  const itemName = (id: number) => items?.find((i) => i.id === id)?.name ?? `Item #${id}`;
  const officerName = (id: number) => { const o = officers?.find((x) => x.id === id); return o ? `${o.firstName} ${o.lastName} (#${o.badgeNumber})` : `Officer #${id}`; };

  const active = useMemo(() => {
    const list = (assignments ?? []).filter((a) => a.status === "active");
    const t = q.toLowerCase();
    if (!t) return list;
    return list.filter((a) => itemName(a.itemId).toLowerCase().includes(t) || officerName(a.officerId).toLowerCase().includes(t));
  }, [assignments, q, items, officers]);

  async function doIssue() {
    if (!officerId || !itemId) return toast({ title: "Select an officer and item", variant: "destructive" });
    if (isUnique && inStockUnits.length === 0)
      return toast({ title: "No serial in stock", description: "Add an available unit on the Inventory page first.", variant: "destructive" });
    if (isUnique && inStockUnits.length > 0 && !unitId)
      return toast({ title: "Select a serial/unit to issue", variant: "destructive" });
    if (isSized && inStockVariants.length === 0)
      return toast({ title: "No size in stock", description: "Add stock for a size on the Inventory page first.", variant: "destructive" });
    if (isSized && !variantId)
      return toast({ title: "Select a size to issue", variant: "destructive" });
    setIssuing(true);
    try {
      await apiRequest("POST", "/api/issue", {
        officerId: Number(officerId), itemId: Number(itemId), quantity: Number(qty) || 1,
        itemUnitId: isUnique && unitId ? Number(unitId) : null,
        itemVariantId: isSized && variantId ? Number(variantId) : null,
        dueDate: dueDate || null, signature, notes, issuedBy: user?.name,
      });
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/items", Number(itemId), "units"] });
      queryClient.invalidateQueries({ queryKey: ["/api/items", Number(itemId), "variants"] });
      toast({ title: "Item issued", description: `${qty}× ${selectedItem?.name}${selectedVariant ? ` (${selectedVariant.size})` : ""}` });
      setIssueCategory(""); setIssueSubcategory(""); setItemId(""); setUnitId(""); setVariantId(""); setQty(1); setDueDate(""); setSignature(""); setNotes("");
    } catch (e: any) {
      toast({ title: "Issue failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setIssuing(false); }
  }

  async function doReturn() {
    if (!returnFor) return;
    setReturning(true);
    try {
      await apiRequest("POST", `/api/return/${returnFor.id}`, { conditionIn, returnedBy: user?.name, notes: returnNote });
      invalidateAll();
      toast({ title: "Item returned" });
      setReturnFor(null); setReturnNote(""); setConditionIn("Good");
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
                <Label>Officer</Label>
                <Select value={officerId} onValueChange={setOfficerId}>
                  <SelectTrigger data-testid="select-officer"><SelectValue placeholder="Select officer…" /></SelectTrigger>
                  <SelectContent>
                    {officers?.filter((o) => o.status === "active").map((o) => (
                      <SelectItem key={o.id} value={String(o.id)}>{o.lastName}, {o.firstName} · #{o.badgeNumber}</SelectItem>
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
                        {inStockUnits.map((u) => <SelectItem key={u.id} value={String(u.id)}>{unitLabel(u)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {isSized && (
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  {inStockVariants.length === 0 ? (
                    <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive" data-testid="text-no-sizes">
                      No sizes in stock. Add stock for a size on the Inventory page before issuing.
                    </p>
                  ) : (
                    <Select value={variantId} onValueChange={(v) => { setVariantId(v); setQty(1); }}>
                      <SelectTrigger data-testid="select-issue-size"><SelectValue placeholder="Select size to issue…" /></SelectTrigger>
                      <SelectContent>
                        {inStockVariants.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.size} — {v.quantity} avail</SelectItem>)}
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input type="number" min={1} max={selectedItem?.type === "unique" ? 1 : isSized ? (selectedVariant?.quantity ?? 1) : selectedItem?.quantity ?? 999}
                    value={qty} onChange={(e) => setQty(Number(e.target.value))} disabled={selectedItem?.type === "unique"} data-testid="input-issue-qty" />
                </div>
                <div className="space-y-1.5">
                  <Label>Due date (optional)</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-due-date" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Recipient signature / acknowledgement</Label>
                <Input placeholder="Type full name to acknowledge receipt" value={signature} onChange={(e) => setSignature(e.target.value)} data-testid="input-signature" />
              </div>

              <div className="space-y-1.5">
                <Label>Notes (optional)</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>

              <Button className="w-full" onClick={doIssue} disabled={issuing} data-testid="button-issue">
                <PackageCheck className="mr-1.5 h-4 w-4" /> {issuing ? "Issuing…" : "Issue Item"}
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
                <SelectContent>{["Good", "Fair", "Poor", "Damaged"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
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
    </div>
  );
}
