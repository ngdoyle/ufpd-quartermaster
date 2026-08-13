import type { ItemWithStock } from "@shared/schema";
import { newDoc, reportFooter, checkbox, MARGIN, LINE, pageH, pageW } from "./pdf";
import { reportFilename } from "@/lib/format";
import {
  INSPECTION_SECTIONS,
  OPERATIONAL_READINESS_WEAPON_GROUPS,
} from "./quarterly-config";

export type Quarter = 1 | 2 | 3 | 4;

const QUARTERS: Record<Quarter, { short: string; long: string }> = {
  1: { short: "Q1 (Jan–Mar)", long: "Q1 (Jan-Mar)" },
  2: { short: "Q2 (Apr–Jun)", long: "Q2 (Apr-Jun)" },
  3: { short: "Q3 (Jul–Sep)", long: "Q3 (Jul-Sep)" },
  4: { short: "Q4 (Oct–Dec)", long: "Q4 (Oct-Dec)" },
};

/** The current reporting quarter, intentionally calculated at PDF generation. */
export function currentReportingPeriod(date = new Date()): { quarter: Quarter; year: number; label: string } {
  const quarter = (Math.floor(date.getMonth() / 3) + 1) as Quarter;
  return { quarter, year: date.getFullYear(), label: `${QUARTERS[quarter].long} ${date.getFullYear()}` };
}

export const QUARTER_LABEL: Record<Quarter, string> = {
  1: QUARTERS[1].short,
  2: QUARTERS[2].short,
  3: QUARTERS[3].short,
  4: QUARTERS[4].short,
};

type CountTriple = { total: number; assigned: number; reserve: number };

function inStockQuantity(item: ItemWithStock): number {
  // GET /api/items derives onHand from in-stock serialized units for unique
  // items and from the inventory quantity for consumables.
  return item.onHand;
}

function totalUnits(item: ItemWithStock): number {
  if (item.type === "unique" && item.unitCounts) return item.unitCounts.total;
  return item.quantity;
}

function issuedUnits(item: ItemWithStock): number {
  if (item.type === "unique" && item.unitCounts) return item.unitCounts.issued;
  return 0;
}

function reportItems(items: ItemWithStock[], category: string, subcategories?: readonly string[]) {
  return items
    .filter((item) => item.category === category && (!subcategories || subcategories.includes(item.subcategory ?? "")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function rowLine(doc: any, y: number, label: string, left = MARGIN, right = pageW(doc) - MARGIN): number {
  doc.setDrawColor(132);
  doc.line(left, y, right, y);
  return y + 5.1;
}

function ensureReportSpace(doc: any, y: number, needed: number, onPage: () => number): number {
  return y + needed > pageH(doc) - 17 ? onPage() : y;
}

function drawQuarterMarker(doc: any, y: number, quarter: Quarter, compact = false): number {
  const width = pageW(doc);
  const names = compact
    ? ["1st Quarter", "2nd Quarter", "3rd Quarter", "4th Quarter"]
    : [QUARTERS[1].short, QUARTERS[2].short, QUARTERS[3].short, QUARTERS[4].short];
  const gap = compact ? 44 : 42;
  let x = compact ? 25 : MARGIN;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(compact ? 8.8 : 8.5);
  names.forEach((label, index) => {
    const active = index + 1 === quarter;
    checkbox(doc, x, y, compact ? 5.2 : 4.5);
    if (active) {
      doc.setFillColor(26, 78, 126);
      doc.rect(x + 1, y - (compact ? 3.3 : 2.8), compact ? 3.2 : 2.6, compact ? 3.2 : 2.6, "F");
    }
    doc.text(label, x + (compact ? 7 : 6), y);
    if (compact) doc.text("Inspection", x + (compact ? 7 : 6), y + 5.7);
    x += gap;
  });
  doc.setDrawColor(160);
  doc.line(MARGIN, compact ? y + 9 : y + 4, width - MARGIN, compact ? y + 9 : y + 4);
  return compact ? y + 14 : y + 8;
}

function drawInspectionHeader(doc: any, period: ReturnType<typeof currentReportingPeriod>): number {
  const width = pageW(doc);
  doc.setFillColor(222, 232, 244);
  doc.rect(MARGIN, 12, width - MARGIN * 2, 12, "F");
  doc.setDrawColor(70);
  doc.rect(MARGIN, 12, width - MARGIN * 2, 12);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("UFPD Quarterly Critical Incident Equipment Inspection Checklist", width / 2, 19, { align: "center" });
  doc.setFontSize(8.5);
  doc.text("Equipment In Armory", width / 2, 23, { align: "center" });
  doc.setFontSize(9);
  doc.text(period.label, MARGIN, 31);
  return drawQuarterMarker(doc, 37, period.quarter);
}

function drawInspectionTableHeader(doc: any, y: number): number {
  const width = pageW(doc);
  const xs = [MARGIN, MARGIN + 30, width - MARGIN - 32, width - MARGIN];
  doc.setFillColor(205, 220, 237);
  doc.rect(MARGIN, y - 4.5, width - MARGIN * 2, 6.4, "F");
  doc.setDrawColor(105);
  doc.rect(MARGIN, y - 4.5, width - MARGIN * 2, 6.4);
  xs.slice(1, -1).forEach((x) => doc.line(x, y - 4.5, x, y + 1.9));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Inspector ID", xs[0] + 1.5, y);
  doc.text("Item Name", xs[1] + 1.5, y);
  doc.text("Quantity On Hand", xs[3] - 1.5, y, { align: "right" });
  return y + 1.9;
}

function drawInspectionRow(doc: any, y: number, name: string, qty: number): number {
  const width = pageW(doc);
  const xs = [MARGIN, MARGIN + 30, width - MARGIN - 32, width - MARGIN];
  const wrap = doc.splitTextToSize(name, xs[2] - xs[1] - 3);
  const height = Math.max(5.1, wrap.length * 3.7 + 1.4);
  doc.setDrawColor(180);
  doc.rect(MARGIN, y, width - MARGIN * 2, height);
  xs.slice(1, -1).forEach((x) => doc.line(x, y, x, y + height));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(wrap, xs[1] + 1.5, y + 3.6);
  doc.setFont("helvetica", "bold");
  doc.text(String(qty), xs[3] - 1.5, y + 3.6, { align: "right" });
  return y + height;
}

function drawInspectionSection(doc: any, y: number, title: string): number {
  const width = pageW(doc);
  doc.setFillColor(170, 199, 229);
  doc.rect(MARGIN, y, width - MARGIN * 2, 5.5, "F");
  doc.setDrawColor(105);
  doc.rect(MARGIN, y, width - MARGIN * 2, 5.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(title, width / 2, y + 3.75, { align: "center" });
  return y + 5.5;
}

/**
 * Quarterly Critical Incident Equipment Inspection Checklist.
 * All rows are live dynamic inventory rows. It intentionally renders no
 * inspector value: Inspector ID stays blank for the handwritten workflow.
 */
export function buildQuarterlyTemplateA(items: ItemWithStock[]) {
  const period = currentReportingPeriod();
  const doc = newDoc("portrait");
  let y = drawInspectionHeader(doc, period);
  y = drawInspectionTableHeader(doc, y);

  for (const section of INSPECTION_SECTIONS) {
    const sectionItems = reportItems(
      items,
      section.category,
      "subcategories" in section ? section.subcategories : undefined,
    );
    if (y > pageH(doc) - 35) {
      doc.addPage();
      y = drawInspectionHeader(doc, period);
      y = drawInspectionTableHeader(doc, y);
    }
    y = drawInspectionSection(doc, y, section.title);
    for (const item of sectionItems) {
      if (y > pageH(doc) - 25) {
        doc.addPage();
        y = drawInspectionHeader(doc, period);
        y = drawInspectionTableHeader(doc, y);
        y = drawInspectionSection(doc, y, `${section.title} (continued)`);
      }
      y = drawInspectionRow(doc, y, item.name, inStockQuantity(item));
    }
  }

  // The paper form keeps the sign-off immediately below the table whenever
  // possible. A reduced 17 mm block fits the common one-page live-data case.
  y = ensureReportSpace(doc, y, 18, () => {
    doc.addPage();
    return drawInspectionHeader(doc, period);
  });
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("Inspection Completed by:", MARGIN, y);
  doc.setDrawColor(110);
  doc.line(MARGIN + 42, y + 0.5, pageW(doc) - MARGIN, y + 0.5);
  y += 8;
  const signatureEnd = MARGIN + 70;
  doc.line(MARGIN, y, signatureEnd, y);
  doc.line(pageW(doc) - MARGIN - 62, y, pageW(doc) - MARGIN, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("Training Commander Signature", MARGIN, y + 4.5);
  doc.text("Date Signed", pageW(doc) - MARGIN - 62, y + 4.5);

  reportFooter(doc);
  return doc;
}

function groupCounts(items: ItemWithStock[], names: readonly string[]): CountTriple {
  const nameSet = new Set(names);
  return items
    .filter((item) => item.category === "Firearms" && nameSet.has(item.name))
    .reduce<CountTriple>((counts, item) => ({
      total: counts.total + totalUnits(item),
      assigned: counts.assigned + issuedUnits(item),
      reserve: counts.reserve + inStockQuantity(item),
    }), { total: 0, assigned: 0, reserve: 0 });
}

function ammoClass(name: string): "duty" | "practice" | null {
  const n = name.toLowerCase();
  // Sim rounds, less-lethal bean bags, and breaching rounds appear on the
  // inspection checklist only; none belongs on Operational Readiness.
  if (/\bsim(?:unition|s)?\b|marking|bean\s*bag|breaching/.test(n)) return null;
  if (/frangible/.test(n)) return "practice";
  if (/\bduty\b/.test(n)) return "duty";
  if (/\bpractice\b/.test(n)) return "practice";
  return null;
}

function ammunitionQuantity(items: ItemWithStock[], caliber: RegExp, bucket: "duty" | "practice"): number {
  return items
    .filter((item) => item.category === "Ammunition" && caliber.test(item.name) && ammoClass(item.name) === bucket)
    .reduce((sum, item) => sum + inStockQuantity(item), 0);
}

function suppressorCounts(items: ItemWithStock[]): { inventoried: number; assigned: number } {
  return reportItems(items, "Firearms Accessories", ["Suppressors"])
    .reduce((counts, item) => ({
      inventoried: counts.inventoried + totalUnits(item),
      assigned: counts.assigned + issuedUnits(item),
    }), { inventoried: 0, assigned: 0 });
}

function drawReadinessHeader(doc: any, period: ReturnType<typeof currentReportingPeriod>): number {
  const width = pageW(doc);
  doc.setFont("times", "bold");
  doc.setFontSize(12.5);
  doc.text("University of Florida Police Department", width / 2, 17, { align: "center" });
  doc.setFontSize(12);
  doc.text("TRAINING DIVISION", width / 2, 25, { align: "center" });
  doc.setFontSize(13);
  doc.text(`OPERATIONAL READINESS ${period.year}`, width / 2, 33, { align: "center" });
  return drawQuarterMarker(doc, 44, period.quarter, true);
}

function drawReadinessGroup(doc: any, y: number, title: string, counts: CountTriple): number {
  const width = pageW(doc);
  doc.setFont("times", "bold");
  doc.setFontSize(10.5);
  doc.text(`${title} – Inspected – Findings`, MARGIN, y);
  doc.setFont("times", "normal");
  doc.setFontSize(8.5);
  doc.text("(Number inspected, number assigned, number in reserve, list deficiencies)", MARGIN, y + 4.3);
  const labelX = MARGIN + 12;
  const valueX = MARGIN + 63;
  const commentsX = MARGIN + 100;
  y += 12;
  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  [["Inspected:", counts.total], ["Number Assigned:", counts.assigned], ["Number in Reserve:", counts.reserve]].forEach(([label, value]) => {
    doc.text(`•   ${label}`, labelX, y);
    doc.setFont("times", "normal");
    doc.text(String(value), valueX, y);
    doc.setDrawColor(105);
    doc.line(valueX - 3, y + 0.5, valueX + 13, y + 0.5);
    doc.setFont("times", "bold");
    y += 5.4;
  });
  doc.setFont("times", "bold");
  doc.setFontSize(8.2);
  doc.text("Comments:", commentsX, y - 16.2);
  for (let i = 0; i < 3; i++) rowLine(doc, y - 12 + i * 8, "", commentsX, width - MARGIN);
  return y + 2;
}

function drawAmmoGroup(doc: any, y: number, title: string, duty: number, practice: number): number {
  const width = pageW(doc);
  doc.setFont("times", "bold");
  doc.setFontSize(10.5);
  doc.text(title, MARGIN, y);
  doc.setFontSize(8.5);
  doc.text("Comments:", MARGIN + 76, y + 4);
  doc.setFontSize(9.5);
  doc.text("Duty:", MARGIN + 12, y + 12);
  doc.text(String(duty), MARGIN + 43, y + 12);
  doc.line(MARGIN + 40, y + 12.5, MARGIN + 54, y + 12.5);
  doc.text("Practice:", MARGIN + 12, y + 18);
  doc.text(String(practice), MARGIN + 43, y + 18);
  doc.line(MARGIN + 40, y + 18.5, MARGIN + 54, y + 18.5);
  rowLine(doc, y + 10, "", MARGIN + 76, width - MARGIN);
  rowLine(doc, y + 17, "", MARGIN + 76, width - MARGIN);
  return y + 29;
}

/** Training Division Operational Readiness Report (two-page paper form). */
export function buildQuarterlyTemplateB(items: ItemWithStock[]) {
  const period = currentReportingPeriod();
  const doc = newDoc("portrait");
  let y = drawReadinessHeader(doc, period);

  OPERATIONAL_READINESS_WEAPON_GROUPS.forEach((group) => {
    y = drawReadinessGroup(doc, y, group.title, groupCounts(items, group.itemNames));
    y += 5;
  });

  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.text("List deficiencies:", MARGIN, y);
  y += 6;
  for (let i = 0; i < 9; i++) {
    y = rowLine(doc, y, "", MARGIN, pageW(doc) - MARGIN);
  }

  doc.addPage();
  const width = pageW(doc);
  y = 24;
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.text("OPERATIONAL READINESS", width / 2, y, { align: "center" });
  y += 17;
  const ammo = [
    { title: "9mm ammo inventory", caliber: /9mm/i },
    { title: "5.56/.223 inventory", caliber: /5\.56|\.223/i },
    { title: "12-gauge inventory", caliber: /12\s*ga|12-gauge/i },
  ];
  ammo.forEach((section) => {
    y = drawAmmoGroup(
      doc,
      y,
      section.title,
      ammunitionQuantity(items, section.caliber, "duty"),
      ammunitionQuantity(items, section.caliber, "practice"),
    );
  });

  const suppressors = suppressorCounts(items);
  doc.setFont("times", "bold");
  doc.setFontSize(10.5);
  doc.text("Suppressors", MARGIN, y);
  doc.setFontSize(9.5);
  doc.text("Inventoried:", MARGIN + 12, y + 12);
  doc.text(String(suppressors.inventoried), MARGIN + 43, y + 12);
  doc.line(MARGIN + 40, y + 12.5, MARGIN + 54, y + 12.5);
  doc.text("Assigned:", MARGIN + 12, y + 18);
  doc.text(String(suppressors.assigned), MARGIN + 43, y + 18);
  doc.line(MARGIN + 40, y + 18.5, MARGIN + 54, y + 18.5);
  doc.setFontSize(8.5);
  doc.text("Comments:", MARGIN + 76, y + 4);
  rowLine(doc, y + 10, "", MARGIN + 76, width - MARGIN);
  rowLine(doc, y + 17, "", MARGIN + 76, width - MARGIN);
  y += 49;

  doc.setFont("times", "bold");
  doc.setFontSize(9.5);
  doc.text("The above items have been inspected in the quarter indicated by:", MARGIN, y);
  y += 14;
  const leftEnd = MARGIN + 67;
  const rightStart = width - MARGIN - 67;
  doc.setDrawColor(105);
  doc.line(MARGIN, y, leftEnd, y);
  doc.line(rightStart, y, width - MARGIN, y);
  doc.setFontSize(8.7);
  doc.text("Signature", MARGIN + 2, y + 4.5);
  doc.text("Date", rightStart + 2, y + 4.5);
  y += 20;
  doc.line(MARGIN, y, leftEnd, y);
  doc.text("Print Name", MARGIN + 2, y + 4.5);
  y += 20;
  doc.line(MARGIN, y, leftEnd, y);
  doc.line(rightStart, y, width - MARGIN, y);
  doc.text("Training Commander Signature", MARGIN + 2, y + 4.5);
  doc.text("Date", rightStart + 2, y + 4.5);

  reportFooter(doc);
  return doc;
}

export function downloadQuarterlyTemplateA(items: ItemWithStock[]) {
  const { quarter, year } = currentReportingPeriod();
  buildQuarterlyTemplateA(items).save(reportFilename(`Quarterly Inspection Checklist Q${quarter} ${year}`, "pdf"));
}

export function downloadQuarterlyTemplateB(items: ItemWithStock[]) {
  const { quarter, year } = currentReportingPeriod();
  buildQuarterlyTemplateB(items).save(reportFilename(`Operational Readiness Q${quarter} ${year}`, "pdf"));
}
