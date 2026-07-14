import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pill, EmptyState } from "@/components/bits";
import { exportCsv } from "@/lib/format";
import { variantLowStock } from "@shared/schema";
import type { Item, ItemVariant, Assignment } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Download, Shirt, X, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

type VariantForm = {
  id?: number;
  size: string;
  sku: string;
  quantity: string;
  parLevel: string;
};

const blankForm = (): VariantForm => ({ size: "", sku: "", quantity: "0", parLevel: "0" });

export function SizeVariantsDialog({
  item, actor, open, onOpenChange,
}: {
  item: Item;
  actor?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const variantsKey = ["/api/items", item.id, "variants"];
  const { data: variants, isLoading } = useQuery<ItemVariant[]>({ queryKey: variantsKey, enabled: open });
  // Active assignments let us disable delete for a size that is still issued.
  const { data: assignments } = useQuery<Assignment[]>({ queryKey: ["/api/assignments"], enabled: open });

  const [form, setForm] = useState<VariantForm | null>(null);
  const [saving, setSaving] = useState(false);

  const total = (variants ?? []).reduce((s, v) => s + v.quantity, 0);
  const issuedSizeIds = new Set(
    (assignments ?? []).filter((a) => a.status === "active" && a.itemVariantId != null).map((a) => a.itemVariantId),
  );

  function refresh() {
    queryClient.invalidateQueries({ queryKey: variantsKey });
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  }

  async function save() {
    if (!form) return;
    if (!form.size.trim()) return toast({ title: "Size is required", variant: "destructive" });
    setSaving(true);
    try {
      const payload = {
        size: form.size.trim(),
        sku: form.sku.trim() || null,
        quantity: Number(form.quantity) || 0,
        parLevel: Number(form.parLevel) || 0,
        actor,
      };
      if (form.id) await apiRequest("PATCH", `/api/variants/${form.id}`, payload);
      else await apiRequest("POST", `/api/items/${item.id}/variants`, payload);
      refresh();
      toast({ title: form.id ? "Size updated" : "Size added" });
      setForm(null);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function adjust(v: ItemVariant, delta: number) {
    const next = Math.max(0, v.quantity + delta);
    if (next === v.quantity) return;
    try {
      await apiRequest("PATCH", `/api/variants/${v.id}`, { quantity: next, actor });
      refresh();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    }
  }

  async function remove(variantId: number) {
    try {
      await apiRequest("DELETE", `/api/variants/${variantId}?actor=${encodeURIComponent(actor ?? "")}`);
      refresh();
      toast({ title: "Size removed" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    }
  }

  function doExport() {
    exportCsv(`${item.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-sizes.csv`,
      (variants ?? []).map((v) => ({
        Size: v.size,
        SKU: v.sku ?? "",
        "On Hand": v.quantity,
        Par: v.parLevel,
        Notes: v.notes ?? "",
      })));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Shirt className="h-4 w-4 text-primary" /> Sizes — {item.name}</DialogTitle>
          <DialogDescription>
            Track stock per size. On-hand for this item is the sum of its sizes; issuing a size decrements only that size.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="gray">{variants?.length ?? 0} sizes</Pill>
            <Pill tone="green">{total} on hand</Pill>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={doExport} disabled={!variants?.length} data-testid="button-export-variants">
              <Download className="mr-1.5 h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={() => setForm(blankForm())} data-testid="button-add-variant">
              <Plus className="mr-1.5 h-4 w-4" /> Add Size
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-md" />)}</div>
        ) : !variants?.length ? (
          <EmptyState title="No sizes yet" hint="Add sizes with their on-hand quantity and optional par level." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 font-medium">SKU</th>
                  <th className="px-3 py-2 font-medium">On hand</th>
                  <th className="px-3 py-2 font-medium">Par</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {variants.map((v) => {
                  const low = variantLowStock(v);
                  const issued = issuedSizeIds.has(v.id);
                  return (
                    <tr key={v.id} className={cn(low && "bg-chart-3/10")} data-testid={`row-variant-${v.id}`}>
                      <td className="px-3 py-2 font-medium">{v.size}</td>
                      <td className="px-3 py-2 text-muted-foreground">{v.sku || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Decrease" onClick={() => adjust(v, -1)} disabled={v.quantity <= 0} data-testid={`button-variant-minus-${v.id}`}>
                            <Minus className="h-3.5 w-3.5" />
                          </Button>
                          <span className={cn("min-w-[2ch] text-center tabular-nums", low && "font-semibold text-chart-3")}>{v.quantity}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" title="Increase" onClick={() => adjust(v, 1)} data-testid={`button-variant-plus-${v.id}`}>
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                          {low && <Pill tone="amber">low</Pill>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{v.parLevel || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => setForm({
                            id: v.id, size: v.size, sku: v.sku ?? "", quantity: String(v.quantity), parLevel: String(v.parLevel),
                          })} data-testid={`button-edit-variant-${v.id}`}><Pencil className="h-4 w-4" /></Button>
                          {issued ? (
                            <Button variant="ghost" size="icon" title="Cannot delete — currently issued" disabled data-testid={`button-delete-variant-${v.id}`}>
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          ) : (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" title="Delete" data-testid={`button-delete-variant-${v.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Remove size {v.size}?</AlertDialogTitle>
                                  <AlertDialogDescription>This permanently removes this size from the item.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => remove(v.id)}>Remove</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add/Edit size sub-form */}
        {form && (
          <div className="mt-4 rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">{form.id ? "Edit Size" : "Add Size"}</p>
              <Button variant="ghost" size="icon" onClick={() => setForm(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Size">
                <Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="e.g. M, 34x32, 10.5" data-testid="input-variant-size" />
              </Field>
              <Field label="SKU (optional)">
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} data-testid="input-variant-sku" />
              </Field>
              <Field label="On hand">
                <Input type="number" min={0} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} data-testid="input-variant-qty" />
              </Field>
              <Field label="Par (0 = none)">
                <Input type="number" min={0} value={form.parLevel} onChange={(e) => setForm({ ...form, parLevel: e.target.value })} data-testid="input-variant-par" />
              </Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving} data-testid="button-save-variant">{saving ? "Saving…" : "Save Size"}</Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}
