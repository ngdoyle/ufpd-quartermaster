import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Pill, EmptyState } from "@/components/bits";
import { fmtDate, fmtCurrency, relativeDays, daysUntil, exportCsv, reportFilename } from "@/lib/format";
import type { Officer, Item, Assignment, ItemWithStock, ItemUnit } from "@shared/schema";
import { variantLowStock } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { isDualSerialItem } from "@/components/serial-units-dialog";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Download, MapPin, CalendarRange, ClipboardCheck, ShieldCheck, FileText, Table2, FileDown,
} from "lucide-react";

import { downloadByLocationPdf, exportByLocationCsv } from "@/lib/reports/by-location";
import { downloadIssuancePdf, exportIssuanceCsv } from "@/lib/reports/issuance";
import { downloadInspectionForm, type InspectionLine } from "@/lib/reports/inspection";
import {
  downloadQuarterlyTemplateA, downloadQuarterlyTemplateB, QUARTER_LABEL, type Quarter,
} from "@/lib/reports/quarterly";
import {
  DATASETS, type Dataset, type CustomConfig, type DataBundle,
  downloadCustomPdf, exportCustomCsv,
} from "@/lib/reports/custom";
import {
  PRESETS, type PresetKey, resolveRange, type Range,
} from "@/lib/reports/timeframe";

export default function Reports() {
  const { toast } = useToast();
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });
  const { data: items } = useQuery<ItemWithStock[]>({ queryKey: ["/api/items"] });
  const { data: assignments } = useQuery<Assignment[]>({ queryKey: ["/api/assignments"] });

  const ready = !!officers && !!items && !!assignments;
  const bundle: DataBundle = { items: items ?? [], assignments: assignments ?? [], officers: officers ?? [] };

  const itemOf = (id: number) => items?.find((i) => i.id === id);
  const officerOf = (id: number) => officers?.find((o) => o.id === id);
  const oName = (id: number) => { const o = officerOf(id); return o ? ((o.type ?? "person") === "business" ? `${o.firstName} (Business)` : `${o.lastName}, ${o.firstName} (#${o.badgeNumber})`) : `#${id}`; };

  const active = useMemo(() => (assignments ?? []).filter((a) => a.status === "active"), [assignments]);

  // Officers that currently have something issued (for the inspection picker).
  const issuedOfficers = useMemo(() => {
    const ids = new Set(active.map((a) => a.officerId));
    return (officers ?? [])
      .filter((o) => ids.has(o.id))
      .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  }, [officers, active]);

  // Resolve the inspection form for one person: every active assignment becomes a
  // line, with serial(s) fetched for serialized (unique) items.
  async function generateInspection(officerId: number) {
    const officer = officerOf(officerId);
    if (!officer) return;
    const rows = active.filter((a) => a.officerId === officerId);
    // Fetch units once per distinct unique item so we can resolve serials.
    const uniqueItemIds = Array.from(new Set(
      rows.map((a) => a.itemId).filter((id) => itemOf(id)?.type === "unique"),
    ));
    const unitsByItem = new Map<number, ItemUnit[]>();
    await Promise.all(uniqueItemIds.map(async (id) => {
      try {
        const res = await apiRequest("GET", `/api/items/${id}/units`);
        unitsByItem.set(id, await res.json());
      } catch { /* leave serials blank if the fetch fails */ }
    }));

    const lines: InspectionLine[] = rows.map((a) => {
      const item = itemOf(a.itemId);
      let serials: string | null = null;
      if (item?.type === "unique" && a.itemUnitId) {
        const u = (unitsByItem.get(a.itemId) ?? []).find((x) => x.id === a.itemUnitId);
        if (u) {
          const dual = isDualSerialItem(item);
          serials = dual && u.secondarySerialNumber
            ? `FP ${u.serialNumber} / BP ${u.secondarySerialNumber}`
            : u.secondarySerialNumber ? `${u.serialNumber} / ${u.secondarySerialNumber}` : u.serialNumber;
        }
      }
      return {
        itemName: item?.name ?? `Item #${a.itemId}`,
        category: item?.category ?? null,
        serials,
        size: (a as any).variantSize ?? null,
        quantity: a.quantity,
      };
    });
    downloadInspectionForm(officer, lines);
    toast({ title: "Inspection form generated", description: `${lines.length} line(s) for the selected personnel.` });
  }

  // ---- Operational tables (preserved) ----
  const overdue = active.filter((a) => a.dueDate && new Date(a.dueDate) < new Date());
  const expiring = (items ?? []).filter((i) => { const d = daysUntil(i.expirationDate); return d !== null && d <= 90; });

  const reorderRows = useMemo(() => {
    const rows: { key: string; name: string; onHand: number; par: number; reorder: number; vendor: string }[] = [];
    for (const i of items ?? []) {
      if (i.type === "sized" && i.variantCounts) {
        for (const s of i.variantCounts.sizes) {
          if (!variantLowStock(s)) continue;
          rows.push({ key: `v${s.id}`, name: `${i.name} — ${s.size}`, onHand: s.quantity, par: s.parLevel, reorder: Math.max(s.parLevel - s.quantity, 0), vendor: i.vendor ?? "—" });
        }
      } else if (i.lowStock) {
        rows.push({ key: `i${i.id}`, name: i.name, onHand: i.onHand, par: i.parLevel, reorder: Math.max(i.parLevel - i.onHand, 0), vendor: i.vendor ?? "—" });
      }
    }
    return rows;
  }, [items]);

  const byCategory = useMemo(() => {
    const map = new Map<string, { count: number; qty: number; value: number }>();
    (items ?? []).forEach((i) => {
      const e = map.get(i.category) ?? { count: 0, qty: 0, value: 0 };
      e.count += 1; e.qty += i.quantity; e.value += (i.unitCost ?? 0) * i.quantity;
      map.set(i.category, e);
    });
    return Array.from(map.entries()).sort((a, b) => b[1].value - a[1].value);
  }, [items]);

  return (
    <div>
      <PageHeader title="Reports" subtitle="Generate printable reports and export operational views" />

      {/* Pre-built report cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ReportCard icon={MapPin} title="Inventory by Location"
          desc="All items grouped by storage location with per-location subtotals and est. value.">
          <Button size="sm" variant="outline" disabled={!ready} onClick={() => downloadByLocationPdf(bundle.items)} data-testid="button-byloc-pdf">
            <FileText className="mr-1.5 h-4 w-4" /> PDF
          </Button>
          <Button size="sm" variant="outline" disabled={!ready} onClick={() => exportByLocationCsv(bundle.items)} data-testid="button-byloc-csv">
            <Table2 className="mr-1.5 h-4 w-4" /> CSV
          </Button>
        </ReportCard>

        <ReportCard icon={CalendarRange} title="Issuance & Activity"
          desc="What was issued in a chosen time frame, to whom and by whom.">
          <IssuanceDialog bundle={bundle} ready={ready} />
        </ReportCard>

        <ReportCard icon={ClipboardCheck} title="Agency Inspection Form"
          desc="One person's currently issued equipment with serials and sign-off blocks.">
          <InspectionDialog officers={issuedOfficers} ready={ready} onGenerate={generateInspection} />
        </ReportCard>

        <ReportCard icon={ShieldCheck} title="Quarterly Inspection Checklist"
          desc="Critical Incident Equipment Inspection (armory) — Template A.">
          <QuarterlyDialog title="Quarterly Inspection Checklist" ready={ready}
            onGenerate={(q, y, id) => downloadQuarterlyTemplateA(bundle.items, q, y, id ?? "")} withInspId />
        </ReportCard>

        <ReportCard icon={ShieldCheck} title="Operational Readiness"
          desc="Training Division operational readiness report — Template B.">
          <QuarterlyDialog title="Operational Readiness" ready={ready}
            onGenerate={(q, y) => downloadQuarterlyTemplateB(bundle.items, q, y)} />
        </ReportCard>

        <ReportCard icon={FileDown} title="Custom Report Generator"
          desc="Pick a dataset, columns, filters and grouping; export PDF or CSV.">
          <CustomGenerator bundle={bundle} ready={ready} />
        </ReportCard>
      </div>

      {/* Operational tables (quick on-screen views) */}
      <h2 className="mt-8 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">Operational Tables</h2>
      <Tabs defaultValue="overdue">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overdue">Overdue ({overdue.length})</TabsTrigger>
          <TabsTrigger value="reorder">Reorder ({reorderRows.length})</TabsTrigger>
          <TabsTrigger value="expiring">Expiring ({expiring.length})</TabsTrigger>
          <TabsTrigger value="totals">Inventory Totals</TabsTrigger>
        </TabsList>

        <TabsContent value="overdue" className="mt-4">
          <ReportShell title="Overdue Returns" onExport={() => exportCsv(reportFilename("Overdue Returns", "csv"), overdue.map((a) => ({
            Officer: oName(a.officerId), Item: itemOf(a.itemId)?.name, Due: fmtDate(a.dueDate), Status: relativeDays(a.dueDate),
          })))}>
            {overdue.length === 0 ? <EmptyState title="No overdue items" /> : (
              <SimpleTable head={["Officer", "Item", "Due", "Status"]}
                rows={overdue.map((a) => [oName(a.officerId), itemOf(a.itemId)?.name ?? "—", fmtDate(a.dueDate), <Pill tone="red">{relativeDays(a.dueDate)}</Pill>])} />
            )}
          </ReportShell>
        </TabsContent>

        <TabsContent value="reorder" className="mt-4">
          <ReportShell title="Reorder List (at/below PAR)" onExport={() => exportCsv(reportFilename("Reorder List (at or below PAR)", "csv"), reorderRows.map((r) => ({
            Item: r.name, OnHand: r.onHand, PAR: r.par, Suggested: r.reorder, Vendor: r.vendor,
          })))}>
            {reorderRows.length === 0 ? <EmptyState title="Stock levels healthy" /> : (
              <SimpleTable head={["Item", "On Hand", "PAR", "Reorder Qty", "Vendor"]}
                rows={reorderRows.map((r) => [r.name, <Pill tone="amber">{r.onHand}</Pill>, String(r.par), String(r.reorder), r.vendor])} />
            )}
          </ReportShell>
        </TabsContent>

        <TabsContent value="expiring" className="mt-4">
          <ReportShell title="Expiring & Expired Items" onExport={() => exportCsv(reportFilename("Expiring and Expired Items", "csv"), expiring.map((i) => ({
            Item: i.name, Serial: i.serialNumber, Expiration: fmtDate(i.expirationDate), Days: daysUntil(i.expirationDate),
          })))}>
            {expiring.length === 0 ? <EmptyState title="No upcoming expirations" /> : (
              <SimpleTable head={["Item", "Serial / SKU", "Expiration", "Status"]}
                rows={expiring.map((i) => { const d = daysUntil(i.expirationDate); return [
                  i.name, i.serialNumber || i.sku || "—", fmtDate(i.expirationDate),
                  <Pill tone={d! < 0 ? "red" : "amber"}>{d! < 0 ? "Expired" : relativeDays(i.expirationDate)}</Pill>]; })} />
            )}
          </ReportShell>
        </TabsContent>

        <TabsContent value="totals" className="mt-4">
          <ReportShell title="Inventory Totals by Category" onExport={() => exportCsv(reportFilename("Inventory Totals by Category", "csv"), byCategory.map(([cat, e]) => ({
            Category: cat, Items: e.count, TotalQty: e.qty, Value: e.value.toFixed(2),
          })))}>
            <SimpleTable head={["Category", "Distinct Items", "Total Qty", "Value"]}
              rows={byCategory.map(([cat, e]) => [cat, String(e.count), String(e.qty), fmtCurrency(e.value)])} />
            <div className="border-t border-border px-4 py-2.5 text-sm font-medium flex justify-between">
              <span>Total inventory value</span>
              <span className="tabular-nums">{fmtCurrency(byCategory.reduce((s, [, e]) => s + e.value, 0))}</span>
            </div>
          </ReportShell>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------- Report card ------------------------------ */

function ReportCard({ icon: Icon, title, desc, children }: {
  icon: React.ComponentType<{ className?: string }>; title: string; desc: string; children: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted p-2"><Icon className="h-5 w-5 text-foreground" /></div>
        <div>
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">{children}</div>
    </Card>
  );
}

/* ------------------------------ Time-frame UI ----------------------------- */

function TimeframePicker({ preset, setPreset, start, setStart, end, setEnd }: {
  preset: PresetKey; setPreset: (p: PresetKey) => void;
  start: string; setStart: (s: string) => void;
  end: string; setEnd: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Time frame</Label>
        <Select value={preset} onValueChange={(v) => setPreset(v as PresetKey)}>
          <SelectTrigger data-testid="select-timeframe"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tf-start">Start</Label>
            <Input id="tf-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="input-tf-start" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tf-end">End</Label>
            <Input id="tf-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="input-tf-end" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------- Issuance -------------------------------- */

function IssuanceDialog({ bundle, ready }: { bundle: DataBundle; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<PresetKey>("30d");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const range: Range = resolveRange(preset, start, end);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!ready} data-testid="button-issuance-open"><CalendarRange className="mr-1.5 h-4 w-4" /> Configure</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Issuance & Activity Report</DialogTitle>
          <DialogDescription>Assignments issued in the selected time frame.</DialogDescription>
        </DialogHeader>
        <TimeframePicker preset={preset} setPreset={setPreset} start={start} setStart={setStart} end={end} setEnd={setEnd} />
        <DialogFooter>
          <Button variant="outline" onClick={() => exportIssuanceCsv(bundle.assignments, bundle.items, bundle.officers, range)} data-testid="button-issuance-csv">
            <Table2 className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button onClick={() => downloadIssuancePdf(bundle.assignments, bundle.items, bundle.officers, preset, range)} data-testid="button-issuance-pdf">
            <FileText className="mr-1.5 h-4 w-4" /> PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Inspection ------------------------------- */

function InspectionDialog({ officers, ready, onGenerate }: {
  officers: Officer[]; ready: boolean; onGenerate: (officerId: number) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!sel) return;
    setBusy(true);
    try { await onGenerate(Number(sel)); setOpen(false); }
    finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!ready} data-testid="button-inspection-open"><ClipboardCheck className="mr-1.5 h-4 w-4" /> Select personnel</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agency Equipment Inspection Form</DialogTitle>
          <DialogDescription>Generates a printable form of all equipment currently issued to one person.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label>Personnel</Label>
          <Select value={sel} onValueChange={setSel}>
            <SelectTrigger data-testid="select-inspection-officer"><SelectValue placeholder="Select personnel with issued equipment" /></SelectTrigger>
            <SelectContent>
              {officers.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">No personnel currently hold equipment</div>}
              {officers.map((o) => (
                <SelectItem key={o.id} value={String(o.id)} data-testid={`option-inspection-${o.id}`}>
                  {(o.type ?? "person") === "business" ? `${o.firstName} (Business)` : `${o.lastName}, ${o.firstName} (#${o.badgeNumber})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button onClick={go} disabled={!sel || busy} data-testid="button-inspection-generate">
            <FileText className="mr-1.5 h-4 w-4" /> {busy ? "Generating…" : "Generate PDF"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- Quarterly ------------------------------- */

function QuarterlyDialog({ title, ready, onGenerate, withInspId }: {
  title: string; ready: boolean;
  onGenerate: (quarter: Quarter, year: number, inspId?: string) => void; withInspId?: boolean;
}) {
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [quarter, setQuarter] = useState<Quarter>((Math.floor(now.getMonth() / 3) + 1) as Quarter);
  const [year, setYear] = useState<number>(now.getFullYear());
  const [inspId, setInspId] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!ready} data-testid="button-quarterly-open"><FileText className="mr-1.5 h-4 w-4" /> Configure</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Quantities auto-fill from live inventory; unmatched rows print blank for handwriting.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Quarter</Label>
              <Select value={String(quarter)} onValueChange={(v) => setQuarter(Number(v) as Quarter)}>
                <SelectTrigger data-testid="select-quarter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {([1, 2, 3, 4] as Quarter[]).map((q) => <SelectItem key={q} value={String(q)}>{QUARTER_LABEL[q]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="q-year">Year</Label>
              <Input id="q-year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="input-year" />
            </div>
          </div>
          {withInspId && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="q-inspid">Inspector ID (optional)</Label>
              <Input id="q-inspid" value={inspId} onChange={(e) => setInspId(e.target.value)} placeholder="Leave blank for handwriting" data-testid="input-inspid" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => { onGenerate(quarter, year, inspId); setOpen(false); }} data-testid="button-quarterly-generate">
            <FileText className="mr-1.5 h-4 w-4" /> Generate PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Custom generator ---------------------------- */

function CustomGenerator({ bundle, ready }: { bundle: DataBundle; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [dataset, setDataset] = useState<Dataset>("inventory");
  const [cols, setCols] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState("all");
  const [officerId, setOfficerId] = useState("all");
  const [groupBy, setGroupBy] = useState<string>("none");
  const [preset, setPreset] = useState<PresetKey>("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");

  const ds = DATASETS[dataset];
  const available = ds.columns;
  const selected = cols.length ? cols : available.map((c) => c.key);

  const categories = useMemo(() => Array.from(new Set(bundle.items.map((i) => i.category))).sort(), [bundle.items]);
  const locations = useMemo(() => Array.from(new Set(bundle.items.map((i) => i.location ?? "").filter(Boolean))).sort(), [bundle.items]);
  const statuses = dataset === "inventory"
    ? ["active", "low", "out", "expiring", "expired", "maintenance", "retired"]
    : ["active", "returned"];

  function toggleCol(key: string) {
    const base = cols.length ? cols : available.map((c) => c.key);
    setCols(base.includes(key) ? base.filter((k) => k !== key) : [...base, key]);
  }
  function switchDataset(d: Dataset) { setDataset(d); setCols([]); setGroupBy("none"); setStatus("all"); }

  const config: CustomConfig = {
    dataset, columns: selected,
    filters: { category, location, status, officerId },
    preset, range: resolveRange(preset, start, end),
    groupBy: groupBy === "none" ? undefined : groupBy,
    title: title || ds.label,
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!ready} data-testid="button-custom-open"><FileDown className="mr-1.5 h-4 w-4" /> Open generator</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Custom Report Generator</DialogTitle>
          <DialogDescription>Choose a dataset, columns, filters and grouping, then export.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cr-title">Report title</Label>
            <Input id="cr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={ds.label} data-testid="input-custom-title" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Dataset</Label>
            <Select value={dataset} onValueChange={(v) => switchDataset(v as Dataset)}>
              <SelectTrigger data-testid="select-dataset"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(DATASETS) as Dataset[]).map((k) => <SelectItem key={k} value={k}>{DATASETS[k].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ds.hint}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Columns</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {available.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={selected.includes(c.key)} onCheckedChange={() => toggleCol(c.key)} data-testid={`check-col-${c.key}`} />
                  {c.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FilterField label="Category" value={category} setValue={setCategory} options={categories} />
            <FilterField label="Location" value={location} setValue={setLocation} options={locations} />
            <FilterField label="Status" value={status} setValue={setStatus} options={statuses} />
            {dataset !== "inventory" && (
              <FilterField label="Personnel" value={officerId} setValue={setOfficerId}
                options={bundle.officers.map((o) => ({ value: String(o.id), label: (o.type ?? "person") === "business" ? o.firstName : `${o.lastName}, ${o.firstName}` }))} />
            )}
          </div>

          {ds.dated && (
            <TimeframePicker preset={preset} setPreset={setPreset} start={start} setStart={setStart} end={end} setEnd={setEnd} />
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Group by</Label>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger data-testid="select-groupby"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                {available.filter((c) => selected.includes(c.key)).map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => exportCustomCsv(config, bundle)} data-testid="button-custom-csv">
            <Table2 className="mr-1.5 h-4 w-4" /> CSV
          </Button>
          <Button onClick={() => downloadCustomPdf(config, bundle)} data-testid="button-custom-pdf">
            <FileText className="mr-1.5 h-4 w-4" /> PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterField({ label, value, setValue, options }: {
  label: string; value: string; setValue: (v: string) => void;
  options: string[] | { value: string; label: string }[];
}) {
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger data-testid={`select-filter-${label.toLowerCase()}`}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          {opts.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ------------------------------ Shared bits ------------------------------ */

function ReportShell({ title, onExport, children }: { title: string; onExport: () => void; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button variant="outline" size="sm" onClick={onExport} data-testid="button-export-report"><Download className="mr-1.5 h-4 w-4" /> Export CSV</Button>
      </div>
      {children}
    </Card>
  );
}

function SimpleTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i} className="hover-elevate">{r.map((c, j) => <td key={j} className="px-4 py-2.5">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
