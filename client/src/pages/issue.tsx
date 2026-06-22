import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp } from "@/lib/app-context";
import { PageHeader, Pill, TypeBadge, EmptyState } from "@/components/bits";
import { fmtDate, fmtDateTime, relativeDays } from "@/lib/format";
import type { Officer, Item, Assignment, ItemUnit } from "@shared/schema";
import { isDualSerialItem } from "@/components/serial-units-dialog";
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
  const { data: items } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: assignments } = useQuery<Assignment[]>({ queryKey: ["/api/assignments"] });

  // issue form state
  const [officerId, setOfficerId] = useState("");
  const [itemId, setItemId] = useState("");
  const [unitId, setUnitId] = useState("");
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

  const availableItems = useMemo(() => (items ?? []).filter((i) => i.status !== "retired" && i.status !== "maintenance" && i.quantity > 0), [items]);
  const selectedItem = items?.find((i) => String(i.id) === itemId);
  const isUnique = selectedItem?.type === "unique";
  const { data: selectedUnits } = useQuery<ItemUnit[]>({
    queryKey: ["/api/items", Number(itemId), "units"],
    enabled: !!isUnique,
  });
  const inStockUnits = useMemo(() => (selectedUnits ?? []).filter((u) => u.status === "in_stock"), [selectedUnits]);
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
    setIssuing(true);
    try {
      await apiRequest("POST", "/api/issue", {
        officerId: Number(officerId), itemId: Number(itemId), quantity: Number(qty) || 1,
        itemUnitId: isUnique && unitId ? Number(unitId) : null,
        dueDate: dueDate || null, signature, notes, issuedBy: user?.name,
      });
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["/api/items", Number(itemId), "units"] });
      toast({ title: "Item issued", description: `${qty}× ${selectedItem?.name}` });
      setItemId(""); setUnitId(""); setQty(1); setDueDate(""); setSignature(""); setNotes("");
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
                <Select value={itemId} onValueChange={(v) => { setItemId(v); setUnitId(""); setQty(1); }}>
                  <SelectTrigger data-testid="select-item"><SelectValue placeholder="Select item in stock…" /></SelectTrigger>
                  <SelectContent>
                    {availableItems.map((i) => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.name}{i.size ? ` (${i.size})` : ""} — {i.quantity} avail
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedItem && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <TypeBadge type={selectedItem.type} />
                    <Pill tone="gray">{selectedItem.quantity} in stock</Pill>
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

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input type="number" min={1} max={selectedItem?.type === "unique" ? 1 : selectedItem?.quantity ?? 999}
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
                        <p className="font-medium leading-tight">{a.quantity}× {itemName(a.itemId)}</p>
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
