import type { ItemWithStock } from "@shared/schema";
import { newDoc, reportHeader, reportFooter, drawTable, sectionTitle, MARGIN, pageW, pageH } from "./pdf";
import { fmtCurrency, exportCsv, reportFilename } from "@/lib/format";

/* ------------------------------------------------------------------ *
 * #5 By-Location report. Items grouped by `location` with per-location
 * subtotals (distinct item count, total on-hand units, est. value where
 * unitCost is known). Est. value = unitCost * onHand (computed stock),
 * summed per location. Items with no location fall under "Unassigned".
 * ------------------------------------------------------------------ */

const UNASSIGNED = "(Unassigned)";

export type LocGroup = {
  location: string;
  items: ItemWithStock[];
  count: number;
  units: number;
  value: number;
};

export function groupByLocation(items: ItemWithStock[]): LocGroup[] {
  const map = new Map<string, ItemWithStock[]>();
  for (const i of items) {
    const loc = (i.location ?? "").trim() || UNASSIGNED;
    (map.get(loc) ?? map.set(loc, []).get(loc)!).push(i);
  }
  return Array.from(map.entries())
    .map(([location, group]) => ({
      location,
      items: group.slice().sort((a, b) => a.name.localeCompare(b.name)),
      count: group.length,
      units: group.reduce((s, i) => s + i.onHand, 0),
      value: group.reduce((s, i) => s + (i.unitCost ?? 0) * i.onHand, 0),
    }))
    .sort((a, b) => a.location.localeCompare(b.location));
}

export function buildByLocationPdf(items: ItemWithStock[]) {
  const groups = groupByLocation(items);
  const doc = newDoc("portrait");
  let y = reportHeader(doc, "Inventory by Location", "On-hand stock and estimated value grouped by storage location");

  const cols = [
    { header: "Item", width: 68 },
    { header: "Category", width: 40 },
    { header: "Type", width: 24 },
    { header: "On Hand", width: 20, align: "right" as const },
    { header: "Unit Cost", width: 20, align: "right" as const },
    { header: "Ext. Value", width: 22, align: "right" as const },
  ];

  let grandCount = 0, grandUnits = 0, grandValue = 0;
  for (const g of groups) {
    if (y > pageH(doc) - 40) { doc.addPage(); y = 20; }
    y = sectionTitle(doc, y + 2, `${g.location}  —  ${g.count} items · ${g.units} on hand · ${fmtCurrency(g.value)}`);
    const rows = g.items.map((i) => [
      i.name, i.category, typeLabel(i.type), i.onHand,
      i.unitCost ? fmtCurrency(i.unitCost) : "—",
      i.unitCost ? fmtCurrency((i.unitCost ?? 0) * i.onHand) : "—",
    ]);
    y = drawTable(doc, y, cols, rows, { headerFill: true }) + 4;
    grandCount += g.count; grandUnits += g.units; grandValue += g.value;
  }

  // Grand total line
  if (y > pageH(doc) - 20) { doc.addPage(); y = 20; }
  const w = pageW(doc);
  doc.setDrawColor(120);
  doc.line(MARGIN, y, w - MARGIN, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`Total: ${grandCount} distinct items · ${grandUnits} units on hand · ${fmtCurrency(grandValue)} estimated value`, MARGIN, y);

  reportFooter(doc);
  return doc;
}

export function downloadByLocationPdf(items: ItemWithStock[]) {
  buildByLocationPdf(items).save(reportFilename("Inventory by Location", "pdf"));
}

export function exportByLocationCsv(items: ItemWithStock[]) {
  const groups = groupByLocation(items);
  const rows: Record<string, any>[] = [];
  for (const g of groups) {
    for (const i of g.items) {
      rows.push({
        Location: g.location, Item: i.name, Category: i.category, Type: typeLabel(i.type),
        OnHand: i.onHand, UnitCost: i.unitCost ?? "", ExtValue: i.unitCost ? (i.unitCost * i.onHand).toFixed(2) : "",
      });
    }
    rows.push({ Location: g.location, Item: "SUBTOTAL", Category: "", Type: "", OnHand: g.units, UnitCost: "", ExtValue: g.value.toFixed(2) });
  }
  exportCsv(reportFilename("Inventory by Location", "csv"), rows);
}

function typeLabel(t: string): string {
  return ({ consumable: "Consumable", returnable: "Returnable", unique: "Serialized", sized: "Sized" } as Record<string, string>)[t] ?? t;
}
