import type { ItemWithStock, Assignment, Officer, Item } from "@shared/schema";
import { newDoc, reportHeader, reportFooter, drawTable, sectionTitle, pageH, type Col } from "./pdf";
import { fmtDate, fmtCurrency, exportCsv, reportFilename } from "@/lib/format";
import { inRange, rangeLabel, type PresetKey, type Range } from "./timeframe";
import { recipientName } from "./issuance";

/* ------------------------------------------------------------------ *
 * #6 Custom Report Generator. Pick a dataset, choose columns, apply
 * filters (category / location / status / personnel / time frame) and a
 * group-by, then render to PDF or CSV. All computation is client-side
 * over the data already loaded by the Reports page.
 * ------------------------------------------------------------------ */

export type Dataset = "inventory" | "assignments" | "personnel";

export type ColumnDef = { key: string; label: string; align?: "right"; width: number };

export const DATASETS: Record<Dataset, { label: string; hint: string; columns: ColumnDef[]; dated: boolean }> = {
  inventory: {
    label: "Inventory", hint: "Catalog items with stock and value", dated: false,
    columns: [
      { key: "name", label: "Item", width: 60 },
      { key: "category", label: "Category", width: 34 },
      { key: "subcategory", label: "Subcategory", width: 34 },
      { key: "type", label: "Type", width: 24 },
      { key: "location", label: "Location", width: 30 },
      { key: "onHand", label: "On Hand", align: "right", width: 20 },
      { key: "parLevel", label: "Par", align: "right", width: 16 },
      { key: "unitCost", label: "Unit Cost", align: "right", width: 22 },
      { key: "extValue", label: "Ext. Value", align: "right", width: 24 },
      { key: "status", label: "Status", width: 24 },
      { key: "vendor", label: "Vendor", width: 34 },
    ],
  },
  assignments: {
    label: "Assignments (issuance)", hint: "Issue records over a time frame", dated: true,
    columns: [
      { key: "issuedAt", label: "Issued", width: 26 },
      { key: "item", label: "Item", width: 56 },
      { key: "recipient", label: "Recipient", width: 56 },
      { key: "quantity", label: "Qty", align: "right", width: 14 },
      { key: "issuedBy", label: "Issued By", width: 34 },
      { key: "dueDate", label: "Due", width: 26 },
      { key: "status", label: "Status", width: 22 },
      { key: "returnedAt", label: "Returned", width: 26 },
    ],
  },
  personnel: {
    label: "Personnel equipment", hint: "What each person currently holds", dated: true,
    columns: [
      { key: "personnel", label: "Personnel", width: 54 },
      { key: "badge", label: "Badge", width: 22 },
      { key: "item", label: "Item", width: 56 },
      { key: "size", label: "Size", width: 18 },
      { key: "quantity", label: "Qty", align: "right", width: 14 },
      { key: "issuedAt", label: "Issued", width: 26 },
      { key: "dueDate", label: "Due", width: 26 },
    ],
  },
};

export type CustomFilters = {
  category?: string;   // "all" or category name
  location?: string;   // "all" or location
  status?: string;     // "all" or status value
  officerId?: string;  // "all" or officer id (string)
};

export type CustomConfig = {
  dataset: Dataset;
  columns: string[];       // selected column keys (in order)
  filters: CustomFilters;
  preset: PresetKey;
  range: Range;
  groupBy?: string;        // column key or undefined
  title: string;
};

export type DataBundle = {
  items: ItemWithStock[];
  assignments: Assignment[];
  officers: Officer[];
};

const isAll = (v?: string) => !v || v === "all";

// Build the full record set for a dataset (before column projection).
function records(config: CustomConfig, data: DataBundle): Record<string, any>[] {
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const offById = new Map(data.officers.map((o) => [o.id, o]));
  const f = config.filters;

  if (config.dataset === "inventory") {
    return data.items
      .filter((i) => (isAll(f.category) || i.category === f.category)
        && (isAll(f.location) || (i.location ?? "") === f.location)
        && (isAll(f.status) || i.status === f.status))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((i) => ({
        name: i.name, category: i.category, subcategory: i.subcategory ?? "",
        type: i.type, location: i.location ?? "(none)", onHand: i.onHand, parLevel: i.parLevel,
        unitCost: i.unitCost ? fmtCurrency(i.unitCost) : "", extValue: i.unitCost ? fmtCurrency(i.unitCost * i.onHand) : "",
        status: i.status, vendor: i.vendor ?? "",
      }));
  }

  if (config.dataset === "assignments") {
    return data.assignments
      .filter((a) => {
        const it = itemById.get(a.itemId);
        return (isAll(f.category) || it?.category === f.category)
          && (isAll(f.location) || (it?.location ?? "") === f.location)
          && (isAll(f.status) || a.status === f.status)
          && (isAll(f.officerId) || String(a.officerId) === f.officerId)
          && inRange(a.issuedAt, config.range);
      })
      .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
      .map((a) => ({
        issuedAt: fmtDate(a.issuedAt), item: itemById.get(a.itemId)?.name ?? `Item #${a.itemId}`,
        recipient: recipientName(offById.get(a.officerId)), quantity: a.quantity,
        issuedBy: a.issuedBy ?? "—", dueDate: a.dueDate ? fmtDate(a.dueDate) : "—",
        status: a.status, returnedAt: a.returnedAt ? fmtDate(a.returnedAt) : "—",
      }));
  }

  // personnel: active assignments only
  return data.assignments
    .filter((a) => a.status === "active")
    .filter((a) => {
      const it = itemById.get(a.itemId);
      return (isAll(f.category) || it?.category === f.category)
        && (isAll(f.location) || (it?.location ?? "") === f.location)
        && (isAll(f.officerId) || String(a.officerId) === f.officerId)
        && (config.range.start || config.range.end ? inRange(a.issuedAt, config.range) : true);
    })
    .map((a) => {
      const o = offById.get(a.officerId);
      return {
        personnel: o ? recipientName(o).replace(/\s*\(#.*\)$/, "") : `#${a.officerId}`,
        badge: o && (o.type ?? "person") !== "business" ? o.badgeNumber : "",
        item: itemById.get(a.itemId)?.name ?? `Item #${a.itemId}`,
        size: (a as any).variantSize ?? "",
        quantity: a.quantity, issuedAt: fmtDate(a.issuedAt), dueDate: a.dueDate ? fmtDate(a.dueDate) : "—",
      };
    })
    .sort((a, b) => a.personnel.localeCompare(b.personnel));
}

function selectedCols(config: CustomConfig): ColumnDef[] {
  const all = DATASETS[config.dataset].columns;
  const chosen = config.columns.length ? config.columns : all.map((c) => c.key);
  return chosen.map((k) => all.find((c) => c.key === k)).filter((c): c is ColumnDef => !!c);
}

function subtitle(config: CustomConfig): string {
  const parts: string[] = [DATASETS[config.dataset].label];
  const f = config.filters;
  if (!isAll(f.category)) parts.push(`Category: ${f.category}`);
  if (!isAll(f.location)) parts.push(`Location: ${f.location}`);
  if (!isAll(f.status)) parts.push(`Status: ${f.status}`);
  if (DATASETS[config.dataset].dated) parts.push(`Time frame: ${rangeLabel(config.preset, config.range)}`);
  return parts.join("  ·  ");
}

export function generateCustomPdf(config: CustomConfig, data: DataBundle) {
  const recs = records(config, data);
  const cols = selectedCols(config);
  const totalW = cols.reduce((s, c) => s + c.width, 0);
  // Landscape when wide.
  const doc = newDoc(totalW > 175 ? "landscape" : "portrait");
  let y = reportHeader(doc, config.title || "Custom Report", subtitle(config));
  const pdfCols: Col[] = cols.map((c) => ({ header: c.label, width: c.width, align: c.align }));

  if (recs.length === 0) {
    doc.setFont("helvetica", "italic"); doc.setFontSize(10);
    doc.text("No records match the selected filters.", 14, y + 4);
    reportFooter(doc);
    return doc;
  }

  const gb = config.groupBy && cols.some((c) => c.key === config.groupBy) ? config.groupBy : undefined;
  if (gb) {
    const groups = new Map<string, Record<string, any>[]>();
    for (const r of recs) { const k = String(r[gb] ?? "—"); (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    const keys = Array.from(groups.keys()).sort();
    const bodyCols = pdfCols.filter((c, i) => cols[i].key !== gb);
    const bodyDefs = cols.filter((c) => c.key !== gb);
    for (const k of keys) {
      if (y > pageH(doc) - 30) { doc.addPage(); y = 20; }
      y = sectionTitle(doc, y + 2, `${labelFor(config, gb)}: ${k}  (${groups.get(k)!.length})`);
      const rows = groups.get(k)!.map((r) => bodyDefs.map((c) => r[c.key] ?? ""));
      y = drawTable(doc, y, bodyCols, rows, { headerFill: true, fontSize: 8 }) + 3;
    }
  } else {
    const rows = recs.map((r) => cols.map((c) => r[c.key] ?? ""));
    y = drawTable(doc, y, pdfCols, rows, { headerFill: true, fontSize: 8 });
  }
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text(`Total: ${recs.length} record(s)`, 14, y + 6);
  reportFooter(doc);
  return doc;
}

function labelFor(config: CustomConfig, key: string): string {
  return DATASETS[config.dataset].columns.find((c) => c.key === key)?.label ?? key;
}

export function downloadCustomPdf(config: CustomConfig, data: DataBundle) {
  generateCustomPdf(config, data).save(reportFilename(config.title || "Custom Report", "pdf"));
}

export function exportCustomCsv(config: CustomConfig, data: DataBundle) {
  const recs = records(config, data);
  const cols = selectedCols(config);
  const rows = recs.map((r) => Object.fromEntries(cols.map((c) => [c.label, r[c.key] ?? ""])));
  exportCsv(reportFilename(config.title || "Custom Report", "csv"), rows);
}
