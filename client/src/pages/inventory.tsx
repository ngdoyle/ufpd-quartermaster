import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp, can } from "@/lib/app-context";
import { PageHeader, StatusBadge, TypeBadge, Pill, EmptyState } from "@/components/bits";
import { Logo } from "@/components/layout";
import { fmtCurrency, fmtDate, daysUntil } from "@/lib/format";
import { exportCsv } from "@/lib/format";
import type { Item } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, QrCode, Pencil, Trash2, Download, Upload, Printer, ClipboardCheck, Package, Layers } from "lucide-react";
import { BulkImport, type ColumnSpec } from "@/components/bulk-import";
import { SerialUnitsDialog } from "@/components/serial-units-dialog";
import { LOCATIONS } from "@/lib/constants";
import {
  ITEM_CATEGORIES, ITEM_SUBCATEGORIES, getItemFields, parseAttributes, attributeSummary,
  ATTRIBUTE_COLUMNS, buildImportAttributes,
  type DynField,
} from "@/lib/item-fields";

type UnitCounts = { total: number; in_stock: number; issued: number; maintenance: number; retired: number };
type InvItem = Item & { unitCounts?: UnitCounts; onHand: number; lowStock: boolean };

const blank = (): Partial<Item> => ({
  name: "", category: "", subcategory: "", type: "consumable", sku: "", serialNumber: "", size: "", color: "",
  quantity: 0, parLevel: 0, location: "", unitCost: 0, vendor: "", grantNumber: "", expirationDate: "",
  lastInspected: "", condition: "New", status: "in_stock", requiresInspection: false, attributes: "", notes: "",
});

export default function Inventory() {
  const { user } = useApp();
  const { toast } = useToast();
  const editable = can.manageInventory(user?.role);
  const { data: items, isLoading } = useQuery<InvItem[]>({ queryKey: ["/api/items"] });

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [form, setForm] = useState<Partial<Item> | null>(null);
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [qr, setQr] = useState<Item | null>(null);
  const [serialsFor, setSerialsFor] = useState<InvItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  function openAdd() { setAttrs({}); setForm(blank()); }
  function openEdit(i: Item) { setAttrs(parseAttributes(i.attributes)); setForm(i); }
  function changeCategory(v: string) {
    setAttrs({});
    setForm((f) => (f ? { ...f, category: v, subcategory: "", serialNumber: "", color: "", size: "", expirationDate: "", lastInspected: "" } : f));
  }
  function renderDyn(f: DynField) {
    const raw = f.bind ? ((form as any)?.[f.bind] ?? "") : (attrs[f.key] ?? "");
    const value = f.type === "date" ? String(raw).slice(0, 10) : String(raw);
    const set = (v: string) => {
      if (f.bind) setForm((cur) => (cur ? { ...cur, [f.bind!]: v } : cur));
      else setAttrs((cur) => ({ ...cur, [f.key]: v }));
    };
    if (f.type === "select") {
      return (
        <Select value={value || undefined} onValueChange={set}>
          <SelectTrigger data-testid={`select-${f.key}`}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>{(f.options ?? []).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
      );
    }
    return <Input type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"} value={value} onChange={(e) => set(e.target.value)} data-testid={`field-${f.key}`} />;
  }

  const matchesStatus = (i: InvItem) => {
    if (status === "all") return true;
    // Low-stock filter uses the API's computed lowStock (single source of truth).
    if (status === "low_stock") return i.lowStock;
    // Serialized items match by their per-unit counts so e.g. the "Issued"
    // filter surfaces an item that has any issued unit, even if other units
    // are still in stock. Falls back to the item status when counts absent.
    if (i.type === "unique" && i.unitCounts && i.unitCounts.total > 0) {
      return (i.unitCounts[status as keyof UnitCounts] ?? 0) > 0;
    }
    return i.status === status;
  };

  const filtered = useMemo(() => {
    if (!items) return [];
    const term = q.toLowerCase();
    return items.filter((i) =>
      (cat === "all" || i.category === cat) &&
      (type === "all" || i.type === type) &&
      matchesStatus(i) &&
      (!term || [i.name, i.sku, i.serialNumber, i.vendor, i.location].some((f) => f?.toLowerCase().includes(term)))
    );
  }, [items, q, cat, type, status]);

  // Filter dropdown: union of the configured categories and any categories
  // present in existing (legacy) data, so older seed items still filter.
  const filterCategories = useMemo(() => {
    const set = new Set<string>(ITEM_CATEGORIES);
    for (const i of items ?? []) if (i.category) set.add(i.category);
    return Array.from(set);
  }, [items]);

  // Form-level computed values for the dynamic fields.
  const categoryOptions = form?.category && !ITEM_CATEGORIES.includes(form.category as any)
    ? [...ITEM_CATEGORIES, form.category]
    : [...ITEM_CATEGORIES];
  const subOptions = ITEM_SUBCATEGORIES[form?.category ?? ""] ?? [];
  const dynFields = getItemFields(form?.category, form?.subcategory);
  const visibleDynFields = dynFields.filter((f) => !f.showIf || f.showIf(attrs));

  async function save() {
    if (!form?.name) return toast({ title: "Name is required", variant: "destructive" });
    setSaving(true);
    try {
      const fields = getItemFields(form.category, form.subcategory);
      const visible = fields.filter((f) => !f.showIf || f.showIf(attrs));
      // Keep only currently-visible, non-bound dynamic fields in the attributes blob.
      const keptAttrs: Record<string, string> = {};
      for (const f of visible) if (!f.bind) { const v = attrs[f.key]; if (v != null && v !== "") keptAttrs[f.key] = v; }
      // Clear any bound core columns that aren't represented by a visible field.
      const boundCols = new Set(visible.filter((f) => f.bind).map((f) => f.bind));
      const cleared: Record<string, string> = {};
      (["serialNumber", "color", "size", "expirationDate", "lastInspected"] as const).forEach((c) => { if (!boundCols.has(c)) cleared[c] = ""; });

      const payload = {
        ...form,
        ...cleared,
        subcategory: form.subcategory || "",
        attributes: Object.keys(keptAttrs).length ? JSON.stringify(keptAttrs) : "",
        quantity: Number(form.quantity) || 0,
        parLevel: Number(form.parLevel) || 0,
        unitCost: Number(form.unitCost) || 0,
        actor: user?.name,
      };
      if (form.id) await apiRequest("PATCH", `/api/items/${form.id}`, payload);
      else await apiRequest("POST", "/api/items", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: form.id ? "Item updated" : "Item added" });
      setForm(null); setAttrs({});
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function remove(id: number) {
    await apiRequest("DELETE", `/api/items/${id}?actor=${encodeURIComponent(user?.name ?? "")}`);
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    toast({ title: "Item deleted" });
  }

  async function inspect(id: number) {
    await apiRequest("POST", `/api/items/${id}/inspect`, { actor: user?.name });
    queryClient.invalidateQueries({ queryKey: ["/api/items"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
    toast({ title: "Inspection logged" });
  }

  function doExport() {
    exportCsv("inventory.csv", filtered.map((i) => ({
      Name: i.name, Category: i.category, Subcategory: i.subcategory ?? "", Type: i.type, SKU: i.sku, Serial: i.serialNumber,
      Size: i.size, Color: i.color, Quantity: i.quantity, PAR: i.parLevel, Location: i.location,
      UnitCost: i.unitCost, Vendor: i.vendor, Expiration: i.expirationDate, Details: attributeSummary(i), Status: i.status,
    })));
  }

  return (
    <div>
      <PageHeader
        title="Inventory Catalog"
        subtitle={`${items?.length ?? 0} items tracked`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={doExport} data-testid="button-export-inventory">
              <Download className="mr-1.5 h-4 w-4" /> Export CSV
            </Button>
            {editable && (
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} data-testid="button-import-inventory">
                <Upload className="mr-1.5 h-4 w-4" /> Bulk Import
              </Button>
            )}
            {editable && (
              <Button size="sm" onClick={openAdd} data-testid="button-add-item">
                <Plus className="mr-1.5 h-4 w-4" /> Add Item
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search name, SKU, serial, vendor…" value={q}
              onChange={(e) => setQ(e.target.value)} data-testid="input-search-inventory" />
          </div>
          <FilterSelect value={cat} onChange={setCat} placeholder="Category" options={filterCategories} />
          <FilterSelect value={type} onChange={setType} placeholder="Type"
            options={[["consumable", "Consumable"], ["returnable", "Returnable"], ["unique", "Serialized"]]} />
          <FilterSelect value={status} onChange={setStatus} placeholder="Status"
            options={[["in_stock", "In Stock"], ["issued", "Issued"], ["maintenance", "Maintenance"], ["retired", "Retired"], ["low_stock", "Low Stock"]]} />
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title="No items match" hint="Adjust filters or add a new item." />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Stock</th>
                    <th className="px-4 py-2.5 font-medium">Location</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((i) => (
                    <ItemRow key={i.id} item={i} editable={editable} onEdit={() => openEdit(i)} onQr={() => setQr(i)} onDelete={remove} onInspect={inspect} onSerials={() => setSerialsFor(i)} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2.5 md:hidden">
            {filtered.map((i) => (
              <Card key={i.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium leading-tight">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[i.category, i.subcategory].filter(Boolean).join(" › ")}
                      {i.serialNumber ? ` · SN ${i.serialNumber}` : ""}
                      {attributeSummary(i) ? ` · ${attributeSummary(i)}` : ""}
                    </p>
                  </div>
                  <StatusCell item={i} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <TypeBadge type={i.type} />
                  <StockPill item={i} />
                  {i.location && <Pill tone="gray">{i.location}</Pill>}
                </div>
                <div className="mt-2.5 flex gap-1.5">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setQr(i)}><QrCode className="mr-1 h-4 w-4" />QR</Button>
                  {i.type === "unique" && <Button variant="outline" size="sm" className="flex-1" onClick={() => setSerialsFor(i)} data-testid={`button-serials-${i.id}`}><Layers className="mr-1 h-4 w-4" />Serials</Button>}
                  {editable && <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(i)}><Pencil className="mr-1 h-4 w-4" />Edit</Button>}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit Item" : "Add Item"}</DialogTitle>
            <DialogDescription>Define the catalog record. Serialized items are unique (quantity 1).</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field className="sm:col-span-2" label="Name"><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-item-name" /></Field>
              <Field label="Category">
                <Select value={form.category || undefined} onValueChange={changeCategory}>
                  <SelectTrigger data-testid="select-item-category"><SelectValue placeholder="Select category…" /></SelectTrigger>
                  <SelectContent>{categoryOptions.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {subOptions.length > 0 && (
                <Field label="Subcategory">
                  <Select value={form.subcategory || undefined} onValueChange={(v) => { setAttrs({}); setForm({ ...form, subcategory: v }); }}>
                    <SelectTrigger data-testid="select-item-subcategory"><SelectValue placeholder="Select subcategory…" /></SelectTrigger>
                    <SelectContent>{subOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Type">
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consumable">Consumable</SelectItem>
                    <SelectItem value="returnable">Returnable</SelectItem>
                    <SelectItem value="unique">Serialized (unique)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="SKU / Asset Tag"><Input value={form.sku ?? ""} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
              <Field label="Quantity on hand"><Input type="number" value={form.quantity ?? 0} onChange={(e) => setForm({ ...form, quantity: e.target.value as any })} data-testid="input-item-qty" /></Field>
              <Field label="PAR / Reorder level"><Input type="number" value={form.parLevel ?? 0} onChange={(e) => setForm({ ...form, parLevel: e.target.value as any })} /></Field>
              <Field label="Location">
                <Select value={form.location || undefined} onValueChange={(v) => setForm({ ...form, location: v })}>
                  <SelectTrigger data-testid="select-location"><SelectValue placeholder="Select location…" /></SelectTrigger>
                  <SelectContent>{LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Unit Cost ($)"><Input type="number" step="0.01" value={form.unitCost ?? 0} onChange={(e) => setForm({ ...form, unitCost: e.target.value as any })} /></Field>
              <Field label="Vendor"><Input value={form.vendor ?? ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} /></Field>
              <Field label="Grant #"><Input value={form.grantNumber ?? ""} onChange={(e) => setForm({ ...form, grantNumber: e.target.value })} /></Field>
              <Field label="Condition">
                <Select value={form.condition ?? "New"} onValueChange={(v) => setForm({ ...form, condition: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{["New", "Good", "Fair", "Poor", "Damaged"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </Field>

              {visibleDynFields.length > 0 && (
                <div className="sm:col-span-2 mt-1 border-t border-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {form.category} Details{form.subcategory ? ` — ${form.subcategory}` : ""}
                  </p>
                </div>
              )}
              {visibleDynFields.map((f) => (
                <Field key={f.key} label={f.label}>{renderDyn(f)}</Field>
              ))}

              <label className="sm:col-span-2 flex items-center gap-2 text-sm">
                <Checkbox checked={!!form.requiresInspection} onCheckedChange={(v) => setForm({ ...form, requiresInspection: !!v })} data-testid="checkbox-inspection" />
                Requires inspection before re-issue (holds in Maintenance on return)
              </label>
              <Field className="sm:col-span-2" label="Notes"><Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving} data-testid="button-save-item">{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR dialog */}
      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader><DialogTitle>Asset QR Label</DialogTitle></DialogHeader>
          {qr && (
            <div id="qr-print" className="flex flex-col items-center gap-3 rounded-lg border border-border p-5 text-center">
              <div className="flex items-center gap-1.5 text-primary"><Logo className="h-4 w-4" /><span className="text-xs font-semibold">UFPD QUARTERMASTER</span></div>
              <QRCodeSVG value={`QM:item:${qr.id}`} size={168} level="M" />
              <div>
                <p className="text-sm font-semibold leading-tight">{qr.name}</p>
                <p className="text-xs text-muted-foreground">{qr.sku || qr.serialNumber || `ID ${qr.id}`}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="w-full" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" /> Print Label</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Serialized units */}
      {serialsFor && (
        <SerialUnitsDialog
          item={serialsFor}
          actor={user?.name}
          open={!!serialsFor}
          onOpenChange={(o) => !o && setSerialsFor(null)}
        />
      )}

      {/* Bulk import */}
      <BulkImport
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Bulk Import Inventory"
        endpoint="/api/items/bulk"
        templateFilename="inventory-import-template.csv"
        actor={user?.name}
        instructions={`One template covers every category. Required: Name. Fill the shared columns plus only the category-specific columns that apply to each row — leave the rest blank. Type is consumable, returnable, or unique. Location must be one of: ${LOCATIONS.join(", ")}. Quantity, PAR, and Unit Cost are numbers; dates use YYYY-MM-DD.`}
        invalidateKeys={["/api/items"]}
        columns={ITEM_COLUMNS}
        sampleRows={ITEM_SAMPLE_ROWS}
        mapRow={(r) => {
          const category = (r["Category"] ?? "General").trim() || "General";
          const subcategory = (r["Subcategory"] ?? "").trim();
          // Route the category-specific columns into the attributes JSON,
          // keeping only the fields that apply to this row's category.
          const attrs = buildImportAttributes(category, subcategory, r);
          return {
            name: (r["Name"] ?? "").trim(),
            category,
            subcategory,
            type: ((r["Type"] ?? "consumable").trim().toLowerCase()) || "consumable",
            sku: (r["SKU"] ?? "").trim(),
            serialNumber: (r["Serial"] ?? "").trim(),
            size: (r["Size"] ?? "").trim(),
            color: (r["Color"] ?? "").trim(),
            quantity: Number((r["Quantity"] ?? "0").trim()) || 0,
            parLevel: Number((r["PAR"] ?? "0").trim()) || 0,
            location: (r["Location"] ?? "").trim(),
            unitCost: Number((r["Unit Cost"] ?? "0").trim()) || 0,
            vendor: (r["Vendor"] ?? "").trim(),
            grantNumber: (r["Grant"] ?? "").trim(),
            expirationDate: (r["Expiration"] ?? "").trim(),
            lastInspected: (r["Last Inspected"] ?? "").trim(),
            condition: (r["Condition"] ?? "New").trim() || "New",
            attributes: Object.keys(attrs).length ? JSON.stringify(attrs) : "",
            notes: (r["Notes"] ?? "").trim(),
          };
        }}
      />
    </div>
  );
}

// One master template. Shared core columns first, then the category-specific
// columns (sourced from the same field registry the Add/Edit form uses), then
// Notes. Fill only the category-specific columns that apply to each row.
const ITEM_COLUMNS: ColumnSpec[] = [
  // --- shared / core columns (apply to every category) ---
  { header: "Name", example: "Glock 17 Gen5", note: "Required" },
  { header: "Category", example: "Firearms", note: "Firearms | Ammunition | Uniforms | Less Lethal | Duty Gear | Ballistic Vests" },
  { header: "Subcategory", example: "Handgun", note: "Must match the chosen Category" },
  { header: "Type", example: "unique", note: "consumable | returnable | unique" },
  { header: "SKU", example: "", note: "Optional internal code" },
  { header: "Serial", example: "", note: "Serialized items (Firearms, TASER)" },
  { header: "Size", example: "", note: "Uniforms, Duty Gear" },
  { header: "Color", example: "", note: "Uniforms, Duty Gear" },
  { header: "Quantity", example: "1" },
  { header: "PAR", example: "0", note: "Reorder threshold" },
  { header: "Location", example: "Armory", note: "Stock Room | Armory | Ammo Storage | DT Lab Storage" },
  { header: "Unit Cost", example: "599" },
  { header: "Vendor", example: "" },
  { header: "Grant", example: "" },
  { header: "Expiration", example: "", note: "OC Spray, TASER Cartridges (YYYY-MM-DD)" },
  { header: "Last Inspected", example: "", note: "Firearms (YYYY-MM-DD)" },
  { header: "Condition", example: "New" },
  // --- category-specific columns (fill only those that apply to the row) ---
  ...ATTRIBUTE_COLUMNS.map((c) => ({ header: c.header, example: c.example, note: c.appliesTo })),
  { header: "Notes", example: "" },
];

// Filled example rows — one per category — so the downloaded template shows
// exactly which columns to fill for each kind of item.
const ITEM_SAMPLE_ROWS: Record<string, string>[] = [
  {
    Name: "Glock 17 Gen5", Category: "Firearms", Subcategory: "Handgun", Type: "unique",
    Serial: "AGX1234", Quantity: "1", PAR: "0", Location: "Armory", "Unit Cost": "599",
    Vendor: "GT Distributors", "Last Inspected": "2026-01-15",
    Make: "Glock", Model: "17 Gen5", Caliber: "9mm",
  },
  {
    Name: "9mm Duty Ammunition", Category: "Ammunition", Subcategory: "Handgun", Type: "consumable",
    Quantity: "1000", PAR: "500", Location: "Ammo Storage", "Unit Cost": "0.45", Vendor: "Federal",
    Brand: "Federal", Model: "HST", Caliber: "9mm", "Ammo Type": "Duty", "Grain Weight": "124gr",
  },
  {
    Name: "Class B Duty Shirt (SS)", Category: "Uniforms", Subcategory: "Sworn Duty Uniforms", Type: "returnable",
    Size: "L", Color: "Navy", Quantity: "24", PAR: "10", Location: "Stock Room", "Unit Cost": "42", Vendor: "5.11",
    Brand: "5.11 Tactical", "Clothing Type": "Duty Shirt SS",
  },
  {
    Name: "MK-4 OC Spray", Category: "Less Lethal", Subcategory: "OC Spray", Type: "consumable",
    Quantity: "30", PAR: "10", Location: "Stock Room", "Unit Cost": "18", Vendor: "Sabre",
    Expiration: "2027-06-01", Brand: "Sabre", Model: "MK-4", "OC Spray Type": "Stream",
  },
  {
    Name: "Level 3 Duty Holster", Category: "Duty Gear", Subcategory: "Duty Belt Gear", Type: "returnable",
    Size: "L", Color: "Black", Quantity: "15", PAR: "5", Location: "Stock Room", "Unit Cost": "129", Vendor: "Safariland",
    Brand: "Safariland", Style: "7TS ALS",
  },
  {
    Name: "Outer Carrier Vest", Category: "Ballistic Vests", Subcategory: "Outer Carrier", Type: "unique",
    Size: "L", Quantity: "1", PAR: "0", Location: "Stock Room", "Unit Cost": "950", Vendor: "Point Blank",
    Brand: "Point Blank", Ballistics: "Yes", "Front Panel Serial": "FP-00123", "Back Panel Serial": "BP-00123",
  },
];

function StockPill({ item }: { item: InvItem }) {
  // On-hand for serialized items excludes issued/maintenance/retired units, so a
  // fully-issued serialized item correctly reads 0 and flags low stock here.
  const onHand = item.onHand ?? item.quantity;
  if (item.type === "unique") {
    return (
      <div className="flex flex-wrap items-center gap-1">
        <Pill tone="purple">Serialized</Pill>
        <Pill tone={item.lowStock ? "amber" : "green"}>{onHand} on hand{item.parLevel ? ` / PAR ${item.parLevel}` : ""}</Pill>
      </div>
    );
  }
  return <Pill tone={item.lowStock ? "amber" : "green"}>{onHand}{item.parLevel ? ` / PAR ${item.parLevel}` : ""}</Pill>;
}

// Status display for inventory rows. Serialized items with tracked units show a
// pill PER non-zero status (e.g. "1 In Stock" + "1 Issued") so the breakdown is
// visible at a glance; everything else shows the single item status badge.
function StatusCell({ item }: { item: InvItem }) {
  const c = item.unitCounts;
  if (item.type === "unique" && c && c.total > 0) {
    const parts: { tone: "green" | "blue" | "amber" | "gray"; label: string; n: number }[] = [
      { tone: "green", label: "In Stock", n: c.in_stock },
      { tone: "blue", label: "Issued", n: c.issued },
      { tone: "amber", label: "Maint", n: c.maintenance },
      { tone: "gray", label: "Retired", n: c.retired },
    ];
    return (
      <div className="flex flex-wrap gap-1">
        {parts.filter((p) => p.n > 0).map((p) => <Pill key={p.label} tone={p.tone}>{p.n} {p.label}</Pill>)}
      </div>
    );
  }
  return <StatusBadge status={item.status} />;
}

function ItemRow({ item, editable, onEdit, onQr, onDelete, onInspect, onSerials }: any) {
  const exp = daysUntil(item.expirationDate);
  const summary = attributeSummary(item);
  return (
    <tr className="hover-elevate" data-testid={`row-item-${item.id}`}>
      <td className="px-4 py-2.5">
        <div className="font-medium leading-tight">{item.name}</div>
        <div className="text-xs text-muted-foreground">
          {[item.category, item.subcategory].filter(Boolean).join(" › ")}{item.serialNumber ? ` · SN ${item.serialNumber}` : item.sku ? ` · ${item.sku}` : ""}
          {summary ? ` · ${summary}` : ""}
          {item.expirationDate && <span className={exp != null && exp < 0 ? "text-destructive" : exp != null && exp <= 90 ? "text-chart-3" : ""}> · exp {fmtDate(item.expirationDate)}</span>}
        </div>
      </td>
      <td className="px-4 py-2.5"><TypeBadge type={item.type} /></td>
      <td className="px-4 py-2.5"><StockPill item={item} /></td>
      <td className="px-4 py-2.5 text-muted-foreground">{item.location || "—"}</td>
      <td className="px-4 py-2.5"><StatusCell item={item} /></td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          {item.status === "maintenance" && editable && (
            <Button variant="ghost" size="icon" title="Pass inspection" onClick={() => onInspect(item.id)} data-testid={`button-inspect-${item.id}`}>
              <ClipboardCheck className="h-4 w-4 text-chart-2" />
            </Button>
          )}
          {item.type === "unique" && (
            <Button variant="ghost" size="icon" title="Manage Serials" onClick={onSerials} data-testid={`button-serials-${item.id}`}><Layers className="h-4 w-4" /></Button>
          )}
          <Button variant="ghost" size="icon" title="QR label" onClick={onQr} data-testid={`button-qr-${item.id}`}><QrCode className="h-4 w-4" /></Button>
          {editable && <Button variant="ghost" size="icon" title="Edit" onClick={onEdit} data-testid={`button-edit-${item.id}`}><Pencil className="h-4 w-4" /></Button>}
          {editable && (
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" size="icon" title="Delete" data-testid={`button-delete-${item.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Delete "{item.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>This permanently removes the item from the catalog.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => onDelete(item.id)}>Delete</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </td>
    </tr>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><Label className="mb-1.5 block text-xs">{label}</Label>{children}</div>;
}

function FilterSelect({ value, onChange, placeholder, options }: {
  value: string; onChange: (v: string) => void; placeholder: string; options: (string | [string, string])[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[140px]"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {placeholder}</SelectItem>
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return <SelectItem key={v} value={v}>{l}</SelectItem>;
        })}
      </SelectContent>
    </Select>
  );
}
