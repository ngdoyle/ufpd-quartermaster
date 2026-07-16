import type { ItemWithStock } from "@shared/schema";
import { newDoc, reportHeader, reportFooter, drawTable, sectionTitle, checkbox, MARGIN, LINE, pageW, pageH } from "./pdf";

/* ==================================================================
 * #4 Quarterly readiness reports — BOTH templates.
 *
 * The field inventory of both forms is CONTRACTUAL (see
 * batch3_report_templates_notes.md): every listed section/row must
 * appear even when the app has no matching item. So both builders emit
 * the fixed row structure from the notes and AUTO-FILL quantities from
 * live inventory via keyword matching; unmatched rows render blank.
 *
 * ---- MAPPING ASSUMPTIONS (documented for user review) ----
 * The sample forms use agency-specific labels (Glock 45 MOS, P320RX,
 * LMT, Moss. 590 …) that do not match the demo inventory 1:1. Each fixed
 * row carries a keyword regex matched against item NAME (optionally
 * scoped by category). Quantity = sum of computed on-hand (onHand) over
 * matching items. Firearm counts for Template B use serialized unit
 * status: Assigned = issued units, Reserve = in-stock units.
 * Ammo "Duty" vs "Practice/Training" is keyword-classified
 * (duty | practice/fmj/frangible/training/sim). 12-gauge munitions in the
 * demo set are less-lethal (bean bag / breaching); with no clear duty vs
 * practice split, all 12ga is bucketed under Duty and Practice is left 0.
 * Rows with no matching inventory show a blank quantity for handwriting.
 * ================================================================== */

export type Quarter = 1 | 2 | 3 | 4;
export const QUARTER_LABEL: Record<Quarter, string> = {
  1: "Q1 (Jan–Mar)", 2: "Q2 (Apr–Jun)", 3: "Q3 (Jul–Sep)", 4: "Q4 (Oct–Dec)",
};

type FixedRow = { label: string; kw?: RegExp; cats?: string[] };
type FixedSection = { title: string; rows: FixedRow[] };

const AMMO = ["Ammunition"];
const FIREARMS = ["Firearms", "Less Lethal"];
const LL = ["Less Lethal"];

// ---- Template A: fixed sections/rows (labels verbatim from the notes) ----
const TEMPLATE_A: FixedSection[] = [
  { title: "Firearms", rows: [
    { label: "Glock 45 MOS", kw: /glock.*45/i, cats: FIREARMS },
    { label: "P320RX (Simunition)", kw: /p320.*(rx|sim)/i, cats: FIREARMS },
    { label: "P320SC", kw: /p320.*(sc|compact|carry)/i, cats: FIREARMS },
    { label: "P365", kw: /p365/i, cats: FIREARMS },
    { label: "LMT", kw: /\blmt\b/i, cats: FIREARMS },
    { label: "SS 516", kw: /516/i, cats: FIREARMS },
    { label: "SS MPX", kw: /mpx/i, cats: FIREARMS },
    { label: "SS M400", kw: /m400/i, cats: FIREARMS },
    { label: "Moss. 590 (Less Lethal)", kw: /590|mossberg/i, cats: FIREARMS },
    { label: "Rem. 870 (Less Lethal)", kw: /870|remington/i, cats: FIREARMS },
    { label: "40mm (Less Lethal)", kw: /40\s?mm|launcher|fn\s?303/i, cats: FIREARMS },
    { label: "Sims Conversion Kits", kw: /conversion|sim.*kit/i, cats: FIREARMS },
  ]},
  { title: "Ammunition", rows: [
    { label: "9mm Trng", kw: /9mm.*(trng|train|practice|fmj)/i, cats: AMMO },
    { label: "9mm Frng", kw: /9mm.*(frng|frangible)/i, cats: AMMO },
    { label: "9mm Duty", kw: /9mm.*(duty|hp)/i, cats: AMMO },
    { label: ".223/5.56 Trn", kw: /(\.223|5\.56).*(trn|train|practice)/i, cats: AMMO },
    { label: ".223/5.56 Duty", kw: /(\.223|5\.56).*duty/i, cats: AMMO },
    { label: "12ga", kw: /12\s?ga/i, cats: AMMO },
    { label: "308 Win", kw: /308/i, cats: AMMO },
    { label: "Sims 9mm", kw: /(sim.*9mm|9mm.*(sim|marking))/i, cats: AMMO },
    { label: "Sims .223", kw: /sim.*(\.223|223)/i, cats: AMMO },
  ]},
  { title: "Less Lethal", rows: [
    { label: "ASP Batons", kw: /asp|baton/i, cats: LL },
    { label: "Taser 7 Weapons", kw: /taser\s*7(?!.*(cartridge|batter))/i, cats: LL },
    { label: "Taser 7 Cartridges (3.5/12)", kw: /taser.*cartridge/i, cats: LL },
    { label: "Taser 7 Batteries", kw: /taser.*batter/i, cats: LL },
    { label: "Active O/C Spray", kw: /(mk-?\d|o\/?c|oc)\s*spray/i, cats: LL },
  ]},
  { title: "Training Equipment", rows: [
    { label: "Blue Gun Handguns", kw: /blue\s?gun.*(handgun|pistol)/i },
    { label: "Blue Gun Rifles", kw: /blue\s?gun.*rifle/i },
    { label: "Misc. rubber weapons", kw: /rubber/i },
    { label: "Inert O/C Spray", kw: /inert/i },
    { label: "Training Taser 7 Cartridges", kw: /(training.*taser|taser.*training)/i },
  ]},
  { title: "VR", rows: [
    { label: "VR Head Set", kw: /vr.*head/i },
    { label: "VR Hand Controllers", kw: /vr.*(hand|controller)/i },
    { label: "VR Taser 7 Trainers", kw: /vr.*taser/i },
    { label: "VR FA Trainers", kw: /vr.*(fa|firearm)/i },
  ]},
];

function rowQty(items: ItemWithStock[], row: FixedRow): number | null {
  if (!row.kw) return null;
  const matches = items.filter((i) =>
    (!row.cats || row.cats.includes(i.category)) && row.kw!.test(i.name));
  if (matches.length === 0) return null;
  return matches.reduce((s, i) => s + i.onHand, 0);
}

export function buildQuarterlyTemplateA(items: ItemWithStock[], quarter: Quarter, year: number, inspId: string) {
  const doc = newDoc("portrait");
  let y = reportHeader(doc,
    "Quarterly Critical Incident Equipment Inspection Checklist",
    "Equipment In Armory");

  // Quarter selector row — active quarter marked with a filled box.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const quarters: Quarter[] = [1, 2, 3, 4];
  let qx = MARGIN;
  quarters.forEach((q) => {
    if (q === quarter) { doc.setFillColor(60, 60, 60); doc.rect(qx, y - 3.2, 3.6, 3.6, "F"); }
    checkbox(doc, qx, y, 3.6);
    doc.text(QUARTER_LABEL[q], qx + 5.5, y);
    qx += 44;
  });
  y += LINE;
  doc.text(`Year: ${year}`, MARGIN, y);
  doc.text(`Insp. ID: ${inspId || "____________"}`, MARGIN + 60, y);
  y += LINE + 1;

  const cols = [
    { header: "Insp. ID", width: 22 },
    { header: "Item", width: 120 },
    { header: `Qty — ${QUARTER_LABEL[quarter]}`, width: 40, align: "right" as const },
  ];

  for (const section of TEMPLATE_A) {
    if (y > pageH(doc) - 30) { doc.addPage(); y = 20; }
    y = sectionTitle(doc, y + 1, section.title);
    const rows = section.rows.map((r) => {
      const q = rowQty(items, r);
      return [inspId || "", r.label, q === null ? "" : String(q)];
    });
    y = drawTable(doc, y, cols, rows, { headerFill: true }) + 3;
  }

  // Sign-off block
  if (y > pageH(doc) - 34) { doc.addPage(); y = 20; }
  y += 4;
  const w = pageW(doc);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Inspection Completed by:", MARGIN, y);
  doc.setDrawColor(120);
  doc.line(MARGIN + 46, y + 0.5, w - MARGIN, y + 0.5);
  y += LINE + 6;
  doc.text("Training Commander Signature:", MARGIN, y);
  doc.line(MARGIN + 56, y + 0.5, w - MARGIN, y + 0.5);
  y += LINE + 6;
  doc.text("Date Signed:", MARGIN, y);
  doc.line(MARGIN + 26, y + 0.5, MARGIN + 100, y + 0.5);

  reportFooter(doc);
  return doc;
}

export function downloadQuarterlyTemplateA(items: ItemWithStock[], quarter: Quarter, year: number, inspId: string) {
  buildQuarterlyTemplateA(items, quarter, year, inspId).save(`quarterly_inspection_checklist_Q${quarter}_${year}.pdf`);
}

/* ----------------------------- Template B ----------------------------- */

// Firearm classification for Template B (name keywords, category Firearms).
const RIFLE = /rifle|ddm4|at308|carbine|\bm4\b|m400|lmt|mpx|516|\.308|5\.56|\.223|daniel\s?defense|accuracy/i;
const HANDGUN = /glock|pistol|handgun|p320|p365|p226|p229|p365/i;
const SHOTGUN = /shotgun|870|590|mossberg|remington|12\s?ga/i;

function firearmCounts(items: ItemWithStock[], kw: RegExp): { assigned: number; reserve: number } {
  const fa = items.filter((i) => i.category === "Firearms" && kw.test(i.name));
  let assigned = 0, reserve = 0;
  for (const i of fa) {
    if (i.unitCounts && i.unitCounts.total > 0) { assigned += i.unitCounts.issued; reserve += i.unitCounts.in_stock; }
    else { reserve += i.onHand; }
  }
  return { assigned, reserve };
}

function ammoQty(items: ItemWithStock[], caliber: RegExp, cls: "duty" | "practice"): number {
  const dutyRe = /duty|hp|breaching|lethal(?!\s*less)/i;
  const pracRe = /practice|fmj|frangible|training|trng|sim|marking|bean\s?bag/i;
  return items
    .filter((i) => i.category === "Ammunition" && caliber.test(i.name) &&
      (cls === "duty" ? dutyRe.test(i.name) && !pracRe.test(i.name) : pracRe.test(i.name)))
    .reduce((s, i) => s + i.onHand, 0);
}

function suppressorCounts(items: ItemWithStock[]): { inventoried: number; assigned: number } {
  const s = items.filter((i) => /suppress|silencer/i.test(i.name));
  let inventoried = 0, assigned = 0;
  for (const i of s) {
    inventoried += i.onHand;
    if (i.unitCounts) assigned += i.unitCounts.issued;
  }
  return { inventoried, assigned };
}

export function buildQuarterlyTemplateB(items: ItemWithStock[], quarter: Quarter, year: number) {
  const doc = newDoc("portrait");
  const w = pageW(doc);

  // Custom header (agency form heading, not the generic report header).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("University of Florida Police Department", w / 2, 18, { align: "center" });
  doc.setFontSize(11);
  doc.text("TRAINING DIVISION", w / 2, 25, { align: "center" });
  doc.text(`OPERATIONAL READINESS ${year}`, w / 2, 32, { align: "center" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString("en-US")}`, w - MARGIN, 12, { align: "right" });
  doc.setTextColor(0);
  doc.setDrawColor(170);
  doc.line(MARGIN, 35, w - MARGIN, 35);
  let y = 42;

  // Quarter checkboxes
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const qlabels = ["1st", "2nd", "3rd", "4th"];
  let qx = MARGIN;
  qlabels.forEach((lab, idx) => {
    const q = (idx + 1) as Quarter;
    if (q === quarter) { doc.setFillColor(60, 60, 60); doc.rect(qx, y - 3.2, 3.6, 3.6, "F"); }
    checkbox(doc, qx, y, 3.6);
    doc.text(`${lab} Quarter Inspection`, qx + 5.5, y);
    qx += 46;
  });
  y += LINE + 3;

  // Firearm sections
  const faSections: { title: string; kw: RegExp }[] = [
    { title: "Rifles", kw: RIFLE },
    { title: "Departmental Handguns", kw: HANDGUN },
    { title: "Departmental Shotguns", kw: SHOTGUN },
  ];
  for (const s of faSections) {
    const { assigned, reserve } = firearmCounts(items, s.kw);
    y = sectionTitle(doc, y + 1, s.title);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    // Inspected (blank), Number Assigned, Number in Reserve
    doc.text("Inspected:", MARGIN, y); doc.setDrawColor(120); doc.line(MARGIN + 20, y + 0.5, MARGIN + 50, y + 0.5);
    doc.text(`Number Assigned: ${assigned}`, MARGIN + 60, y);
    doc.text(`Number in Reserve: ${reserve}`, MARGIN + 120, y);
    y += LINE;
    y = commentsLine(doc, y);
    y += 2;
  }

  // Deficiencies block
  y = sectionTitle(doc, y + 1, "List deficiencies:");
  for (let i = 0; i < 3; i++) { doc.setDrawColor(150); doc.line(MARGIN, y, w - MARGIN, y); y += LINE + 1; }

  // ---- Page 2: ammo inventories + suppressors + signatures ----
  doc.addPage();
  y = 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Operational Readiness ${year} — Inventory (cont.)`, w / 2, y, { align: "center" });
  doc.setDrawColor(170); doc.line(MARGIN, y + 4, w - MARGIN, y + 4);
  y += 12;

  const ammo: { title: string; caliber: RegExp }[] = [
    { title: "9mm Ammunition Inventory", caliber: /9mm/i },
    { title: "5.56 / .223 Inventory", caliber: /5\.56|\.223/i },
    { title: "12-Gauge Inventory", caliber: /12\s?ga/i },
  ];
  for (const a of ammo) {
    y = sectionTitle(doc, y + 1, a.title);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    doc.text(`Duty: ${ammoQty(items, a.caliber, "duty")}`, MARGIN, y);
    doc.text(`Practice: ${ammoQty(items, a.caliber, "practice")}`, MARGIN + 60, y);
    y += LINE;
    y = commentsLine(doc, y);
    y += 2;
  }

  const sup = suppressorCounts(items);
  y = sectionTitle(doc, y + 1, "Suppressors");
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text(`Inventoried: ${sup.inventoried}`, MARGIN, y);
  doc.text(`Assigned: ${sup.assigned}`, MARGIN + 60, y);
  y += LINE;
  y = commentsLine(doc, y);
  y += 6;

  // Signature block
  doc.setFont("helvetica", "bold"); doc.setFontSize(9);
  doc.text("The above items have been inspected in the quarter indicated by:", MARGIN, y);
  y += LINE + 6;
  const half = (w - MARGIN * 2 - 10) / 2;
  doc.setDrawColor(120);
  doc.line(MARGIN, y, MARGIN + half, y);
  doc.line(w - MARGIN - half, y, w - MARGIN, y);
  y += 4; doc.setFont("helvetica", "normal");
  doc.text("Signature", MARGIN, y); doc.text("Date", w - MARGIN - half, y);
  y += 12;
  doc.line(MARGIN, y, MARGIN + half, y);
  y += 4; doc.text("Print Name", MARGIN, y);
  y += 12;
  doc.line(MARGIN, y, MARGIN + half, y);
  doc.line(w - MARGIN - half, y, w - MARGIN, y);
  y += 4;
  doc.text("Training Commander Signature", MARGIN, y); doc.text("Date", w - MARGIN - half, y);

  reportFooter(doc);
  return doc;
}

function commentsLine(doc: any, y: number): number {
  const w = pageW(doc);
  doc.setFont("helvetica", "italic"); doc.setFontSize(8);
  doc.text("Comments:", MARGIN, y);
  doc.setDrawColor(150);
  doc.line(MARGIN + 18, y + 0.5, w - MARGIN, y + 0.5);
  doc.setFont("helvetica", "normal");
  return y + LINE;
}

export function downloadQuarterlyTemplateB(items: ItemWithStock[], quarter: Quarter, year: number) {
  buildQuarterlyTemplateB(items, quarter, year).save(`operational_readiness_Q${quarter}_${year}.pdf`);
}
