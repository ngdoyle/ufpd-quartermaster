import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient, errorMessage } from "@/lib/queryClient";
import { useApp } from "@/lib/app-context";
import { PageHeader, Pill, EmptyState } from "@/components/bits";
import type { Officer, Item, ItemUnit, ItemVariant } from "@shared/schema";
import { isDualSerialItem } from "@/components/serial-units-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Boxes, Trash2, Send, X } from "lucide-react";

interface KitWithItems { id: number; name: string; description?: string; items: { id: number; itemId: number; quantity: number }[]; }

export default function Kits() {
  const { user } = useApp();
  const { toast } = useToast();
  const { data: kits, isLoading } = useQuery<KitWithItems[]>({ queryKey: ["/api/kits"] });
  const { data: items } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [lines, setLines] = useState<{ itemId: string; quantity: number }[]>([{ itemId: "", quantity: 1 }]);
  const [saving, setSaving] = useState(false);

  const [issueKit, setIssueKit] = useState<KitWithItems | null>(null);
  const [issueOfficer, setIssueOfficer] = useState("");
  const [unitSelections, setUnitSelections] = useState<Record<number, string>>({});
  const [variantSelections, setVariantSelections] = useState<Record<number, string>>({});
  const [issuing, setIssuing] = useState(false);

  const itemName = (id: number) => items?.find((i) => i.id === id)?.name ?? `Item #${id}`;
  const itemById = (id: number) => items?.find((i) => i.id === id);
  // Serialized (`unique`) items in the kit being issued — each needs a unit pick.
  const serializedLines = (issueKit?.items ?? []).filter((l) => itemById(l.itemId)?.type === "unique");
  const allSerialsChosen = serializedLines.every((l) => unitSelections[l.itemId]);
  // Sized (`sized`) items in the kit — each offers a size pick. Unlike serials,
  // a missing pick doesn't block the whole kit: the server skips only that line.
  const sizedLines = (issueKit?.items ?? []).filter((l) => itemById(l.itemId)?.type === "sized");

  function openIssue(k: KitWithItems) { setIssueKit(k); setIssueOfficer(""); setUnitSelections({}); setVariantSelections({}); }

  async function saveKit() {
    const valid = lines.filter((l) => l.itemId);
    if (!name || valid.length === 0) return toast({ title: "Add a name and at least one item", variant: "destructive" });
    setSaving(true);
    try {
      await apiRequest("POST", "/api/kits", {
        name, description: desc, actor: user?.name,
        items: valid.map((l) => ({ itemId: Number(l.itemId), quantity: Number(l.quantity) || 1 })),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/kits"] });
      toast({ title: "Kit template created" });
      setCreating(false); setName(""); setDesc(""); setLines([{ itemId: "", quantity: 1 }]);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteKit(id: number) {
    await apiRequest("DELETE", `/api/kits/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/kits"] });
    toast({ title: "Kit deleted" });
  }

  async function doIssueKit() {
    if (!issueKit || !issueOfficer) return toast({ title: "Select an officer", variant: "destructive" });
    if (!allSerialsChosen) return toast({ title: "Select a serial for each serialized item", variant: "destructive" });
    setIssuing(true);
    try {
      const selections: Record<number, number> = {};
      for (const [k, v] of Object.entries(unitSelections)) selections[Number(k)] = Number(v);
      const vSelections: Record<number, number> = {};
      for (const [k, v] of Object.entries(variantSelections)) if (v) vSelections[Number(k)] = Number(v);
      const res = await apiRequest("POST", `/api/kits/${issueKit.id}/issue`, {
        officerId: Number(issueOfficer), issuedBy: user?.name, unitSelections: selections, variantSelections: vSelections,
      });
      const r = await res.json();
      ["/api/assignments", "/api/items", "/api/dashboard"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      serializedLines.forEach((l) => queryClient.invalidateQueries({ queryKey: ["/api/items", l.itemId, "units"] }));
      sizedLines.forEach((l) => queryClient.invalidateQueries({ queryKey: ["/api/items", l.itemId, "variants"] }));
      toast({
        title: `Kit issued — ${r.issued} items`,
        description: r.skipped?.length ? `Skipped: ${r.skipped.join(", ")}` : undefined,
      });
      setIssueKit(null); setIssueOfficer(""); setUnitSelections({}); setVariantSelections({});
    } catch (e: any) {
      toast({ title: "Issue failed", description: errorMessage(e), variant: "destructive" });
    } finally { setIssuing(false); }
  }

  return (
    <div>
      <PageHeader title="Kit Templates" subtitle="Standard-issue equipment sets for fast onboarding"
        actions={<Button size="sm" onClick={() => setCreating(true)} data-testid="button-add-kit"><Plus className="mr-1.5 h-4 w-4" /> New Kit</Button>} />

      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-lg" />)}</div>
      ) : !kits?.length ? (
        <EmptyState title="No kit templates yet" hint="Create a standard-issue set to onboard new officers in one step." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {kits.map((k) => (
            <Card key={k.id} className="flex flex-col p-4" data-testid={`card-kit-${k.id}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><Boxes className="h-5 w-5" /></span>
                  <div>
                    <p className="font-medium leading-tight">{k.name}</p>
                    <p className="text-xs text-muted-foreground">{k.items.length} items</p>
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon" data-testid={`button-delete-kit-${k.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Delete "{k.name}"?</AlertDialogTitle><AlertDialogDescription>This removes the template only — already-issued items are unaffected.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteKit(k.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
              {k.description && <p className="mt-2 text-sm text-muted-foreground">{k.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {k.items.map((l) => <Pill key={l.id} tone="gray">{l.quantity}× {itemName(l.itemId)}</Pill>)}
              </div>
              <Button className="mt-4" variant="outline" onClick={() => openIssue(k)} data-testid={`button-issue-kit-${k.id}`}>
                <Send className="mr-1.5 h-4 w-4" /> Issue to Officer
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* Create kit dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>New Kit Template</DialogTitle><DialogDescription>Bundle items into a reusable standard-issue set.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Kit name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Patrol Officer Standard Issue" data-testid="input-kit-name" /></div>
            <div className="space-y-1.5"><Label>Description</Label><Textarea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Items</Label>
              {lines.map((l, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={l.itemId} onValueChange={(v) => setLines(lines.map((x, i) => i === idx ? { ...x, itemId: v } : x))}>
                    <SelectTrigger className="flex-1" data-testid={`select-kit-item-${idx}`}><SelectValue placeholder="Select item…" /></SelectTrigger>
                    <SelectContent>{items?.map((i) => <SelectItem key={i.id} value={String(i.id)}>{i.name}{i.size ? ` (${i.size})` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={1} className="w-20" value={l.quantity} onChange={(e) => setLines(lines.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} />
                  {lines.length > 1 && <Button variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, i) => i !== idx))}><X className="h-4 w-4" /></Button>}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setLines([...lines, { itemId: "", quantity: 1 }])}><Plus className="mr-1 h-4 w-4" /> Add line</Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={saveKit} disabled={saving} data-testid="button-save-kit">{saving ? "Saving…" : "Create Kit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Issue kit dialog */}
      <Dialog open={!!issueKit} onOpenChange={(o) => !o && setIssueKit(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader><DialogTitle>Issue "{issueKit?.name}"</DialogTitle><DialogDescription>All in-stock items in this kit will be issued to the selected officer. Serialized items require choosing a specific unit.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Officer</Label>
              <Select value={issueOfficer} onValueChange={setIssueOfficer}>
                <SelectTrigger data-testid="select-kit-officer"><SelectValue placeholder="Select officer…" /></SelectTrigger>
                <SelectContent>{officers?.filter((o) => o.status === "active").map((o) => <SelectItem key={o.id} value={String(o.id)}>{o.lastName}, {o.firstName} · #{o.badgeNumber}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {serializedLines.length > 0 && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Serialized items — pick a unit</p>
                {serializedLines.map((l) => {
                  const item = itemById(l.itemId)!;
                  return (
                    <KitUnitPicker
                      key={l.itemId}
                      item={item}
                      value={unitSelections[l.itemId] ?? ""}
                      onChange={(v) => setUnitSelections((s) => ({ ...s, [l.itemId]: v }))}
                    />
                  );
                })}
              </div>
            )}
            {sizedLines.length > 0 && (
              <div className="space-y-3 border-t border-border pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sized items — pick a size</p>
                {sizedLines.map((l) => {
                  const item = itemById(l.itemId)!;
                  return (
                    <KitVariantPicker
                      key={l.itemId}
                      item={item}
                      value={variantSelections[l.itemId] ?? ""}
                      onChange={(v) => setVariantSelections((s) => ({ ...s, [l.itemId]: v }))}
                    />
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueKit(null)}>Cancel</Button>
            <Button onClick={doIssueKit} disabled={issuing || !issueOfficer || !allSerialsChosen} data-testid="button-confirm-issue-kit">{issuing ? "Issuing…" : "Issue Kit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Per-serialized-item unit picker for the kit issue flow. Lists the item's
// in-stock units; if none are available it blocks with a clear warning so the
// kit cannot be issued with a null serial.
function KitUnitPicker({ item, value, onChange }: { item: Item; value: string; onChange: (v: string) => void }) {
  const { data: units } = useQuery<ItemUnit[]>({ queryKey: ["/api/items", item.id, "units"] });
  const inStock = (units ?? []).filter((u) => u.status === "in_stock");
  const label = (u: ItemUnit) => (u.secondarySerialNumber ? `${u.serialNumber} / ${u.secondarySerialNumber}` : u.serialNumber);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{item.name}{isDualSerialItem(item) ? " (panel serials)" : ""}</Label>
      {inStock.length === 0 ? (
        <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive" data-testid={`text-kit-no-units-${item.id}`}>
          No available {item.name} units in stock — add a unit or remove it from the kit.
        </p>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger data-testid={`select-kit-unit-${item.id}`}><SelectValue placeholder="Select serial…" /></SelectTrigger>
          <SelectContent>{inStock.map((u) => <SelectItem key={u.id} value={String(u.id)}>{label(u)}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}

// Per-sized-item size picker for the kit issue flow. Lists the item's in-stock
// sizes; if none have stock it warns, and leaving it unselected simply skips
// that line server-side (the rest of the kit still issues).
function KitVariantPicker({ item, value, onChange }: { item: Item; value: string; onChange: (v: string) => void }) {
  const { data: variants } = useQuery<ItemVariant[]>({ queryKey: ["/api/items", item.id, "variants"] });
  const inStock = (variants ?? []).filter((v) => v.quantity > 0);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{item.name}</Label>
      {inStock.length === 0 ? (
        <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive" data-testid={`text-kit-no-sizes-${item.id}`}>
          No {item.name} sizes in stock — add stock or remove it from the kit.
        </p>
      ) : (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger data-testid={`select-kit-size-${item.id}`}><SelectValue placeholder="Select size…" /></SelectTrigger>
          <SelectContent>{inStock.map((v) => <SelectItem key={v.id} value={String(v.id)}>{v.size} — {v.quantity} avail</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}
