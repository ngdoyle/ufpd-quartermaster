import type { Assignment, Item, Officer } from "@shared/schema";
import { newDoc, reportHeader, reportFooter, drawTable, MARGIN, pageW } from "./pdf";
import { fmtDate, exportCsv, reportFilename } from "@/lib/format";
import { inRange, rangeLabel, type PresetKey, type Range } from "./timeframe";

/* ------------------------------------------------------------------ *
 * #16 Issuance / Activity report. Assignments whose issuedAt falls in
 * the selected time frame: what was issued, to whom, and by whom.
 * ------------------------------------------------------------------ */

export function recipientName(o?: Officer): string {
  if (!o) return "—";
  return (o.type ?? "person") === "business"
    ? `${o.firstName} (Business)`
    : `${o.lastName}, ${o.firstName} (#${o.badgeNumber})`;
}

export type IssuanceRow = {
  issuedAt: string;
  item: string;
  size: string;
  quantity: number;
  recipient: string;
  issuedBy: string;
  dueDate: string | null;
  status: string;
};

export function buildIssuanceRows(
  assignments: Assignment[], items: Item[], officers: Officer[], range: Range,
): IssuanceRow[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const offById = new Map(officers.map((o) => [o.id, o]));
  return assignments
    .filter((a) => inRange(a.issuedAt, range))
    .sort((a, b) => new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime())
    .map((a) => ({
      issuedAt: a.issuedAt,
      item: itemById.get(a.itemId)?.name ?? `Item #${a.itemId}`,
      size: (a as any).variantSize ?? "",
      quantity: a.quantity,
      recipient: recipientName(offById.get(a.officerId)),
      issuedBy: a.issuedBy ?? "—",
      dueDate: a.dueDate ?? null,
      status: a.status,
    }));
}

export function buildIssuancePdf(
  assignments: Assignment[], items: Item[], officers: Officer[], preset: PresetKey, range: Range,
) {
  const rows = buildIssuanceRows(assignments, items, officers, range);
  const doc = newDoc("landscape");
  let y = reportHeader(doc, "Issuance & Activity Report",
    `Time frame: ${rangeLabel(preset, range)}  ·  ${rows.length} issuance record(s)`);

  const cols = [
    { header: "Issued", width: 26 },
    { header: "Item", width: 70 },
    { header: "Size", width: 18 },
    { header: "Qty", width: 14, align: "right" as const },
    { header: "Recipient", width: 66 },
    { header: "Issued By", width: 40 },
    { header: "Due", width: 26 },
    { header: "Status", width: 22 },
  ];
  const tableRows = rows.map((r) => [
    fmtDate(r.issuedAt), r.item, r.size || "—", r.quantity, r.recipient, r.issuedBy,
    r.dueDate ? fmtDate(r.dueDate) : "—", r.status === "active" ? "Active" : "Returned",
  ]);

  if (rows.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("No items were issued in the selected time frame.", MARGIN, y + 4);
  } else {
    y = drawTable(doc, y, cols, tableRows, { headerFill: true, fontSize: 8 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    const active = rows.filter((r) => r.status === "active").length;
    doc.text(`Total ${rows.length} record(s) — ${active} still active, ${rows.length - active} returned.`, MARGIN, y + 6);
  }
  reportFooter(doc);
  return doc;
}

export function downloadIssuancePdf(
  assignments: Assignment[], items: Item[], officers: Officer[], preset: PresetKey, range: Range,
) {
  buildIssuancePdf(assignments, items, officers, preset, range).save(reportFilename("Issuance Report", "pdf"));
}

export function exportIssuanceCsv(
  assignments: Assignment[], items: Item[], officers: Officer[], range: Range,
) {
  const rows = buildIssuanceRows(assignments, items, officers, range).map((r) => ({
    Issued: fmtDate(r.issuedAt), Item: r.item, Size: r.size, Qty: r.quantity,
    Recipient: r.recipient, IssuedBy: r.issuedBy, Due: r.dueDate ? fmtDate(r.dueDate) : "", Status: r.status,
  }));
  exportCsv(reportFilename("Issuance Report", "csv"), rows);
}
