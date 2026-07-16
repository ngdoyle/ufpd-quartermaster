import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp, can } from "@/lib/app-context";
import { PageHeader, Pill, EmptyState } from "@/components/bits";
import type { Officer, Item } from "@shared/schema";
import { KIT_CART_KEY, type KitCartPayload } from "./issue";
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
import { Plus, Boxes, Trash2, Send, X, Pencil } from "lucide-react";

interface KitWithItems { id: number; name: string; description?: string; items: { id: number; itemId: number; quantity: number }[]; }

export default function Kits() {
  const { user } = useApp();
  const { toast } = useToast();
  const { data: kits, isLoading } = useQuery<KitWithItems[]>({ queryKey: ["/api/kits"] });
  const { data: items } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [lines, setLines] = useState<{ itemId: string; quantity: number }[]>([{ itemId: "", quantity: 1 }]);
  const [saving, setSaving] = useState(false);
  const canManage = can.issueReturn(user?.role);

  const [, navigate] = useLocation();

  const itemName = (id: number) => items?.find((i) => i.id === id)?.name ?? `Item #${id}`;

  // Load a kit's lines into the Issue-page cart and navigate there (#13/#14).
  // Serial/size resolution and all-or-nothing validation happen in the cart.
  function loadKitToCart(k: KitWithItems) {
    const payload: KitCartPayload = {
      kitName: k.name,
      lines: k.items.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
    };
    sessionStorage.setItem(KIT_CART_KEY, JSON.stringify(payload));
    navigate("/issue");
  }

  function resetKitForm() { setName(""); setDesc(""); setLines([{ itemId: "", quantity: 1 }]); setEditingId(null); }

  function openEdit(k: KitWithItems) {
    setEditingId(k.id);
    setName(k.name);
    setDesc(k.description ?? "");
    setLines(k.items.length ? k.items.map((l) => ({ itemId: String(l.itemId), quantity: l.quantity })) : [{ itemId: "", quantity: 1 }]);
    setCreating(true);
  }

  function onCreateOpenChange(open: boolean) { setCreating(open); if (!open) resetKitForm(); }

  async function saveKit() {
    const valid = lines.filter((l) => l.itemId);
    if (!name || valid.length === 0) return toast({ title: "Add a name and at least one item", variant: "destructive" });
    setSaving(true);
    try {
      const payload = {
        name, description: desc, actor: user?.name,
        items: valid.map((l) => ({ itemId: Number(l.itemId), quantity: Number(l.quantity) || 1 })),
      };
      if (editingId != null) await apiRequest("PATCH", `/api/kits/${editingId}`, payload);
      else await apiRequest("POST", "/api/kits", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/kits"] });
      toast({ title: editingId != null ? "Kit template updated" : "Kit template created" });
      setCreating(false); resetKitForm();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function deleteKit(id: number) {
    await apiRequest("DELETE", `/api/kits/${id}`);
    queryClient.invalidateQueries({ queryKey: ["/api/kits"] });
    toast({ title: "Kit deleted" });
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
                <div className="flex items-center gap-1">
                {canManage && <Button variant="ghost" size="icon" onClick={() => openEdit(k)} data-testid={`button-edit-kit-${k.id}`}><Pencil className="h-4 w-4" /></Button>}
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="ghost" size="icon" data-testid={`button-delete-kit-${k.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Delete "{k.name}"?</AlertDialogTitle><AlertDialogDescription>This removes the template only — already-issued items are unaffected.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteKit(k.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                </div>
              </div>
              {k.description && <p className="mt-2 text-sm text-muted-foreground">{k.description}</p>}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {k.items.map((l) => <Pill key={l.id} tone="gray">{l.quantity}× {itemName(l.itemId)}</Pill>)}
              </div>
              <Button className="mt-4" variant="outline" onClick={() => loadKitToCart(k)} disabled={!canManage} data-testid={`button-issue-kit-${k.id}`}>
                <Send className="mr-1.5 h-4 w-4" /> Issue to Officer
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* Create kit dialog */}
      <Dialog open={creating} onOpenChange={onCreateOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editingId != null ? "Edit Kit Template" : "New Kit Template"}</DialogTitle><DialogDescription>Bundle items into a reusable standard-issue set.</DialogDescription></DialogHeader>
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
            <Button variant="outline" onClick={() => onCreateOpenChange(false)}>Cancel</Button>
            <Button onClick={saveKit} disabled={saving} data-testid="button-save-kit">{saving ? "Saving…" : editingId != null ? "Save Changes" : "Create Kit"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
