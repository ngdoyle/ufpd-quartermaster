import type { Officer } from "@shared/schema";
import { newDoc, reportHeader, reportFooter, MARGIN, LINE, pageW, pageH, checkbox } from "./pdf";
import { genStamp } from "./pdf";

/* ------------------------------------------------------------------ *
 * #21 Agency Equipment Inspection Form. One personnel, one page (paginates
 * if needed): every item currently issued to them with serial(s), an empty
 * check box per line for hand check-off, and signature/date blocks for the
 * personnel inspected and the supervisor conducting the inspection.
 * ------------------------------------------------------------------ */

export type InspectionLine = {
  itemName: string;
  category?: string | null;
  serials?: string | null; // pre-formatted; "FP … / BP …" for dual-serial units
  size?: string | null;
  quantity: number;
};

function personLabel(o: Officer): { name: string; badge: string } {
  if ((o.type ?? "person") === "business") return { name: o.firstName, badge: "" };
  return { name: `${o.firstName} ${o.lastName}`, badge: o.badgeNumber };
}

export function buildInspectionForm(officer: Officer, lines: InspectionLine[]) {
  const doc = newDoc("portrait");
  const w = pageW(doc);
  const { name, badge } = personLabel(officer);
  let y = reportHeader(doc, "Agency Equipment Inspection Form",
    "Physical inspection of all equipment currently issued");

  // Subject block
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Personnel:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.text(name || "—", MARGIN + 24, y);
  if (badge) {
    doc.setFont("helvetica", "bold");
    doc.text("Badge #:", w / 2 + 10, y);
    doc.setFont("helvetica", "normal");
    doc.text(badge, w / 2 + 30, y);
  }
  y += LINE;
  doc.setFont("helvetica", "bold");
  doc.text("Inspection date:", MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.text(genStamp(), MARGIN + 30, y);
  doc.setFont("helvetica", "bold");
  doc.text("Items issued:", w / 2 + 10, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(lines.length), w / 2 + 34, y);
  y += LINE + 2;

  // Table header: [ ] Item | Category | Serial(s) | Qty
  const colChk = MARGIN;
  const colItem = MARGIN + 10;
  const colCat = MARGIN + 78;
  const colSer = MARGIN + 116;
  const colQty = w - MARGIN - 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Chk", colChk, y);
  doc.text("Item", colItem, y);
  doc.text("Category", colCat, y);
  doc.text("Serial(s)", colSer, y);
  doc.text("Qty", colQty, y, { align: "right" });
  y += 1.5;
  doc.setDrawColor(150);
  doc.line(MARGIN, y, w - MARGIN, y);
  y += 5;
  doc.setFont("helvetica", "normal");

  if (lines.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.text("No equipment currently issued to this individual.", MARGIN, y + 2);
    y += LINE;
  } else {
    for (const l of lines) {
      const itemLines = doc.splitTextToSize(l.itemName + (l.size ? ` (${l.size})` : ""), 64);
      const serLines = doc.splitTextToSize(l.serials || "—", w - MARGIN - colSer - 10);
      const rows = Math.max(itemLines.length, serLines.length, 1);
      const rowH = rows * (LINE - 1) + 2;
      if (y + rowH > pageH(doc) - 60) { doc.addPage(); y = 20; }
      checkbox(doc, colChk, y, 4);
      doc.text(itemLines, colItem, y);
      doc.text(l.category || "—", colCat, y);
      doc.text(serLines, colSer, y);
      doc.text(String(l.quantity), colQty, y, { align: "right" });
      y += rowH;
      doc.setDrawColor(228);
      doc.line(MARGIN, y - 3, w - MARGIN, y - 3);
    }
  }

  // Signature blocks — ensure room, else new page
  if (y > pageH(doc) - 55) { doc.addPage(); y = 24; }
  y = pageH(doc) - 46;
  doc.setDrawColor(120);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const half = (w - MARGIN * 2 - 10) / 2;

  // Personnel inspected
  doc.line(MARGIN, y, MARGIN + half, y);
  doc.line(w - MARGIN - half, y, w - MARGIN, y);
  y += 4;
  doc.text("Signature — Personnel Inspected", MARGIN, y);
  doc.text("Date", w - MARGIN - half, y);
  y += 16;

  // Supervisor conducting
  doc.line(MARGIN, y, MARGIN + half, y);
  doc.line(w - MARGIN - half, y, w - MARGIN, y);
  y += 4;
  doc.text("Signature — Supervisor Conducting Inspection", MARGIN, y);
  doc.text("Date", w - MARGIN - half, y);

  reportFooter(doc);
  return doc;
}

function slug(s: string) { return s.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, ""); }

export function downloadInspectionForm(officer: Officer, lines: InspectionLine[]) {
  const { name } = personLabel(officer);
  buildInspectionForm(officer, lines).save(`inspection_${slug(name)}_${Date.now()}.pdf`);
}
