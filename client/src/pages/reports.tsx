import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Pill, EmptyState } from "@/components/bits";
import { fmtDate, fmtCurrency, relativeDays, daysUntil, exportCsv } from "@/lib/format";
import type { Officer, Item, Assignment, ItemWithStock } from "@shared/schema";
import { variantLowStock } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";

export default function Reports() {
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });
  const { data: items } = useQuery<ItemWithStock[]>({ queryKey: ["/api/items"] });
  const { data: assignments } = useQuery<Assignment[]>({ queryKey: ["/api/assignments"] });

  const itemOf = (id: number) => items?.find((i) => i.id === id);
  const officerOf = (id: number) => officers?.find((o) => o.id === id);
  const oName = (id: number) => { const o = officerOf(id); return o ? `${o.lastName}, ${o.firstName} (#${o.badgeNumber})` : `#${id}`; };

  const active = useMemo(() => (assignments ?? []).filter((a) => a.status === "active"), [assignments]);

  const [issuedOfficerFilter, setIssuedOfficerFilter] = useState<string>("all");
  // Officers that currently have something issued, sorted by name, for the picker.
  const issuedOfficers = useMemo(() => {
    const ids = new Set(active.map((a) => a.officerId));
    return (officers ?? [])
      .filter((o) => ids.has(o.id))
      .sort((a, b) => (a.lastName + a.firstName).localeCompare(b.lastName + b.firstName));
  }, [officers, active]);
  const issuedRows = useMemo(
    () => (issuedOfficerFilter === "all" ? active : active.filter((a) => String(a.officerId) === issuedOfficerFilter)),
    [active, issuedOfficerFilter],
  );
  const selectedOfficer = issuedOfficers.find((o) => String(o.id) === issuedOfficerFilter);
  const overdue = active.filter((a) => a.dueDate && new Date(a.dueDate) < new Date());
  const expiring = (items ?? []).filter((i) => { const d = daysUntil(i.expirationDate); return d !== null && d <= 90; });

  // Reorder list. Sized items track PAR per size, so they expand into one row
  // per low size; every other type contributes a single item-level row.
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
      <PageHeader title="Reports" subtitle="Operational reports — export any view to CSV" />
      <Tabs defaultValue="issued">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="issued">Issued to Officer</TabsTrigger>
          <TabsTrigger value="overdue">Overdue ({overdue.length})</TabsTrigger>
          <TabsTrigger value="reorder">Reorder ({reorderRows.length})</TabsTrigger>
          <TabsTrigger value="expiring">Expiring ({expiring.length})</TabsTrigger>
          <TabsTrigger value="totals">Inventory Totals</TabsTrigger>
        </TabsList>

        {/* Issued */}
        <TabsContent value="issued" className="mt-4">
          <div className="mb-3 flex flex-col gap-1.5 sm:max-w-xs">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="select-issued-officer">Officer</label>
            <Select value={issuedOfficerFilter} onValueChange={setIssuedOfficerFilter}>
              <SelectTrigger id="select-issued-officer" data-testid="select-issued-officer">
                <SelectValue placeholder="Select an officer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-issued-all">All officers</SelectItem>
                {issuedOfficers.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)} data-testid={`option-issued-${o.id}`}>
                    {o.lastName}, {o.firstName} (#{o.badgeNumber})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ReportShell
            title={selectedOfficer ? `Issued to ${selectedOfficer.firstName} ${selectedOfficer.lastName}` : "Currently Issued Equipment"}
            onExport={() => exportCsv(selectedOfficer ? `issued_${selectedOfficer.lastName}.csv` : "issued.csv", issuedRows.map((a) => ({
              Officer: oName(a.officerId), Item: itemOf(a.itemId)?.name, Qty: a.quantity, Issued: fmtDate(a.issuedAt), Due: fmtDate(a.dueDate), Condition: a.conditionOut,
            })))}>
            {issuedRows.length === 0 ? <EmptyState title={selectedOfficer ? "Nothing issued to this officer" : "Nothing issued"} /> : (
              <SimpleTable head={["Officer", "Item", "Qty", "Issued", "Due"]}
                rows={issuedRows.map((a) => [oName(a.officerId), itemOf(a.itemId)?.name ?? "—", String(a.quantity), fmtDate(a.issuedAt),
                  a.dueDate ? <Pill tone={new Date(a.dueDate) < new Date() ? "red" : "gray"}>{relativeDays(a.dueDate)}</Pill> : "—"])} />
            )}
          </ReportShell>
        </TabsContent>

        {/* Overdue */}
        <TabsContent value="overdue" className="mt-4">
          <ReportShell title="Overdue Returns" onExport={() => exportCsv("overdue.csv", overdue.map((a) => ({
            Officer: oName(a.officerId), Item: itemOf(a.itemId)?.name, Due: fmtDate(a.dueDate), Status: relativeDays(a.dueDate),
          })))}>
            {overdue.length === 0 ? <EmptyState title="No overdue items" /> : (
              <SimpleTable head={["Officer", "Item", "Due", "Status"]}
                rows={overdue.map((a) => [oName(a.officerId), itemOf(a.itemId)?.name ?? "—", fmtDate(a.dueDate), <Pill tone="red">{relativeDays(a.dueDate)}</Pill>])} />
            )}
          </ReportShell>
        </TabsContent>

        {/* Reorder */}
        <TabsContent value="reorder" className="mt-4">
          <ReportShell title="Reorder List (at/below PAR)" onExport={() => exportCsv("reorder.csv", reorderRows.map((r) => ({
            Item: r.name, OnHand: r.onHand, PAR: r.par, Suggested: r.reorder, Vendor: r.vendor,
          })))}>
            {reorderRows.length === 0 ? <EmptyState title="Stock levels healthy" /> : (
              <SimpleTable head={["Item", "On Hand", "PAR", "Reorder Qty", "Vendor"]}
                rows={reorderRows.map((r) => [r.name, <Pill tone="amber">{r.onHand}</Pill>, String(r.par), String(r.reorder), r.vendor])} />
            )}
          </ReportShell>
        </TabsContent>

        {/* Expiring */}
        <TabsContent value="expiring" className="mt-4">
          <ReportShell title="Expiring & Expired Items" onExport={() => exportCsv("expiring.csv", expiring.map((i) => ({
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

        {/* Totals */}
        <TabsContent value="totals" className="mt-4">
          <ReportShell title="Inventory Totals by Category" onExport={() => exportCsv("inventory_totals.csv", byCategory.map(([cat, e]) => ({
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
