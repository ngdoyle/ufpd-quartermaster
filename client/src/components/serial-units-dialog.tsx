import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Pill, StatusBadge, EmptyState } from "@/components/bits";
import { exportCsv } from "@/lib/format";
import type { Item, ItemUnit, Officer } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Download, Layers, X } from "lucide-react";
import { LOCATIONS } from "@/lib/constants";
import { CONDITIONS, normalizeCondition } from "@shared/validation";

/** Dual-serial items (e.g. ballistic vests) carry two panel serials (FP/BP).
 *  Driven by the per-item `requiresDualSerial` flag; falls back to the legacy
 *  Ballistic Vests category so pre-flag data still renders both panels. */
export const isDualSerialItem = (item: { category?: string | null; requiresDualSerial?: boolean | null }) =>
  !!item.requiresDualSerial || item.category === "Ballistic Vests";

type UnitForm = {
  id?: number;
  serialNumber: string;
  secondarySerialNumber: string;
  condition: string;
  location: string;
  acquiredDate: string;
  notes: string;
};

const blankForm = (item: Item): UnitForm => ({
  serialNumber: "", secondarySerialNumber: "", condition: "NEW",
  location: item.location ?? "", acquiredDate: "", notes: "",
});

export function SerialUnitsDialog({
  item, actor, open, onOpenChange,
}: {
  item: Item;
  actor?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const dual = isDualSerialItem(item);
  const unitsKey = ["/api/items", item.id, "units"];
  const { data: units, isLoading } = useQuery<ItemUnit[]>({ queryKey: unitsKey, enabled: open });
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"], enabled: open });

  const [form, setForm] = useState<UnitForm | null>(null);
  const [saving, setSaving] = useState(false);

  const officerName = (id?: number | null) => {
    if (!id) return null;
    const o = officers?.find((x) => x.id === id);
    return o ? `${o.lastName}, ${o.firstName}` : `#${id}`;
  };

  function refresh() {
    queryClient.invalidateQueries({ queryKey: unitsKey });
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
  }

  async function save() {
    if (!form) return;
    if (!form.serialNumber.trim())
      return toast({ title: dual ? "Front Panel Serial is required" : "Serial number is required", variant: "destructive" });
    if (dual && !form.secondarySerialNumber.trim())
      return toast({ title: "Back Panel Serial is required", variant: "destructive" });
    setSaving(true);
    try {
      const payload = {
        serialNumber: form.serialNumber.trim(),
        secondarySerialNumber: dual ? form.secondarySerialNumber.trim() : null,
        condition: form.condition,
        location: form.location,
        acquiredDate: form.acquiredDate,
        notes: form.notes,
        actor,
      };
      if (form.id) await apiRequest("PATCH", `/api/units/${form.id}`, payload);
      else await apiRequest("POST", `/api/items/${item.id}/units`, payload);
      refresh();
      toast({ title: form.id ? "Serial updated" : "Serial added" });
      setForm(null);
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function remove(unitId: number) {
    try {
      await apiRequest("DELETE", `/api/units/${unitId}?actor=${encodeURIComponent(actor ?? "")}`);
      refresh();
      toast({ title: "Serial removed" });
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    }
  }

  function doExport() {
    exportCsv(`${item.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-serials.csv`,
      (units ?? []).map((u) => ({
        "Serial #": u.serialNumber,
        ...(dual ? { "Back Panel Serial": u.secondarySerialNumber ?? "" } : {}),
        Status: u.status,
        Condition: u.condition ?? "",
        Location: u.location ?? "",
        "Assigned Officer": officerName(u.assignedOfficerId) ?? "",
        Acquired: u.acquiredDate ?? "",
        Notes: u.notes ?? "",
      })));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Serialized Units — {item.name}</DialogTitle>
          <DialogDescription>
            Track each physical {dual ? "vest (front + back panel serials)" : "unit by serial number"}. Status updates as units are issued and returned.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Pill tone="gray">{units?.length ?? 0} total</Pill>
            <Pill tone="green">{units?.filter((u) => u.status === "in_stock").length ?? 0} in stock</Pill>
            <Pill tone="blue">{units?.filter((u) => u.status === "issued").length ?? 0} issued</Pill>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={doExport} disabled={!units?.length} data-testid="button-export-units">
              <Download className="mr-1.5 h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={() => setForm(blankForm(item))} data-testid="button-add-unit">
              <Plus className="mr-1.5 h-4 w-4" /> Add Serial
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-md" />)}</div>
        ) : !units?.length ? (
          <EmptyState title="No serialized units yet" hint="Add serials individually or in bulk below." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{dual ? "Panel Serials" : "Serial #"}</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Condition</th>
                  <th className="px-3 py-2 font-medium">Location</th>
                  <th className="px-3 py-2 font-medium">Assigned</th>
                  <th className="px-3 py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {units.map((u) => (
                  <tr key={u.id} data-testid={`row-unit-${u.id}`}>
                    <td className="px-3 py-2 font-medium">
                      {dual ? (
                        <div className="leading-tight">
                          <div>Front: {u.serialNumber}</div>
                          <div className="text-muted-foreground">Back: {u.secondarySerialNumber ?? "—"}</div>
                        </div>
                      ) : u.serialNumber}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={u.status} /></td>
                    <td className="px-3 py-2 text-muted-foreground">{u.condition ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{u.location || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{officerName(u.assignedOfficerId) ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" title="Edit" onClick={() => setForm({
                          id: u.id, serialNumber: u.serialNumber, secondarySerialNumber: u.secondarySerialNumber ?? "",
                          condition: normalizeCondition(u.condition ?? "NEW"), location: u.location ?? "", acquiredDate: u.acquiredDate ?? "", notes: u.notes ?? "",
                        })} data-testid={`button-edit-unit-${u.id}`}><Pencil className="h-4 w-4" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="Delete" data-testid={`button-delete-unit-${u.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove serial {u.serialNumber}?</AlertDialogTitle>
                              <AlertDialogDescription>This permanently removes this unit from the item.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => remove(u.id)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Add/Edit serial sub-form */}
        {form && (
          <div className="mt-4 rounded-md border border-border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">{form.id ? "Edit Serial" : "Add Serial"}</p>
              <Button variant="ghost" size="icon" onClick={() => setForm(null)}><X className="h-4 w-4" /></Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {dual ? (
                <>
                  <Field label="Front Panel Serial">
                    <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} data-testid="input-unit-serial" />
                  </Field>
                  <Field label="Back Panel Serial">
                    <Input value={form.secondarySerialNumber} onChange={(e) => setForm({ ...form, secondarySerialNumber: e.target.value })} data-testid="input-unit-serial-2" />
                  </Field>
                </>
              ) : (
                <Field className="sm:col-span-2" label="Serial Number">
                  <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} data-testid="input-unit-serial" />
                </Field>
              )}
              <Field label="Condition">
                <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                  <SelectTrigger data-testid="select-unit-condition"><SelectValue /></SelectTrigger>
                  <SelectContent>{CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Location">
                <Select value={form.location || undefined} onValueChange={(v) => setForm({ ...form, location: v })}>
                  <SelectTrigger data-testid="select-unit-location"><SelectValue placeholder="Select location…" /></SelectTrigger>
                  <SelectContent>{LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Acquired date">
                <Input type="date" value={(form.acquiredDate ?? "").slice(0, 10)} onChange={(e) => setForm({ ...form, acquiredDate: e.target.value })} />
              </Field>
              <Field className="sm:col-span-2" label="Notes">
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving} data-testid="button-save-unit">{saving ? "Saving…" : "Save Serial"}</Button>
            </div>
          </div>
        )}

        {/* Bulk add */}
        {!form && <BulkAddSerials item={item} actor={actor} onDone={refresh} />}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkAddSerials({ item, actor, onDone }: { item: Item; actor?: string; onDone: () => void }) {
  const { toast } = useToast();
  const dual = isDualSerialItem(item);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (rawLines.length === 0) return toast({ title: "Enter at least one serial", variant: "destructive" });
    setSaving(true);
    try {
      let body: any;
      if (dual) {
        const parsed: { serialNumber: string; secondarySerialNumber: string }[] = [];
        for (const line of rawLines) {
          const [front, back] = line.split(",").map((p) => p.trim());
          if (!front) return finishErr("Each line needs a Front Panel Serial.");
          if (!back) return finishErr(`Back Panel Serial is required (line "${line}").`);
          parsed.push({ serialNumber: front, secondarySerialNumber: back });
        }
        body = { units: parsed, actor };
      } else {
        body = { serials: rawLines, actor };
      }
      await apiRequest("POST", `/api/items/${item.id}/units`, body);
      onDone();
      toast({ title: `Added ${rawLines.length} serial(s)` });
      setText(""); setOpen(false);
    } catch (e: any) {
      toast({ title: "Bulk add failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }

    function finishErr(msg: string) {
      setSaving(false);
      toast({ title: msg, variant: "destructive" });
    }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-bulk-add-units">
          <Plus className="mr-1.5 h-4 w-4" /> Bulk Add Serials
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-md border border-dashed border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">{dual ? "Bulk Add Vests" : "Bulk Add Serials"}</p>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
      </div>
      <Label className="mb-1.5 block text-xs">
        {dual ? "One vest per line as front,back" : "One serial number per line"}
      </Label>
      <Textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={dual ? "FP-001,BP-001\nFP-002,BP-002" : "SN-001\nSN-002\nSN-003"}
        data-testid="textarea-bulk-serials"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving} data-testid="button-submit-bulk-units">
          {saving ? "Adding…" : dual ? "Add Vests" : "Add Serials"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}
