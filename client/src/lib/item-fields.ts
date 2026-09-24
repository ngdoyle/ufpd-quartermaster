// ------------------------------------------------------------------
// Dynamic Add/Edit Item form configuration.
// Category -> Subcategories -> conditional field definitions.
// A field either binds to a core item column (`bind`) or is stored in
// the item's `attributes` JSON blob (no `bind`).
// ------------------------------------------------------------------
import type { Item, Officer } from "@shared/schema";

export const ITEM_CATEGORIES = [
  "Firearms",
  "Firearms Accessories",
  "Ammunition",
  "Training Gear",
  "Uniforms",
  "Less Lethal",
  "Duty Gear",
  "Ballistic Vests",
] as const;

// Subcategory options per category.
export const ITEM_SUBCATEGORIES: Record<string, readonly string[]> = {
  "Firearms": ["Handgun", "Rifle", "Shotgun (Lethal)", "Shotgun (Less Lethal)", "40mm Grenade Launcher (Less Lethal)", "Simunitions", "Sniper Rifle"],
  "Firearms Accessories": ["Attachments", "Suppressors"],
  "Ammunition": ["Handgun", "Rifle", "Shotgun", "40mm Grenade Launcher (Less Lethal)", "Simunitions", "Sniper Rifle"],
  "Training Gear": ["VR Gear", "Inert Weapons", "Mats/Pads"],
  "Uniforms": ["Sworn Duty Uniforms", "Non-Sworn Duty Uniforms", "Uniform Accessories"],
  "Less Lethal": ["OC Spray", "Baton", "TASER", "TASER Cartridges"],
  "Duty Gear": ["Duty Belt Gear", "Vest Gear", "Traffic Gear", "Miscellaneous Gear"],
  "Ballistic Vests": ["Inner Carrier", "Outer Carrier"],
};

// Core columns a dynamic field can bind to (instead of the attributes blob).
export type BindColumn = "serialNumber" | "color" | "size" | "expirationDate" | "lastInspected";

export type DynField = {
  key: string;                 // attributes key (or, when bound, the logical name)
  label: string;
  type: "text" | "number" | "date" | "select";
  options?: string[];          // for type === "select"
  bind?: BindColumn;           // if present, value lives on the core Item column
  showIf?: (attrs: Record<string, string>) => boolean; // conditional visibility
};

const SERIAL = (label = "Serial Number"): DynField => ({ key: "serialNumber", label, type: "text", bind: "serialNumber" });
const COLOR: DynField = { key: "color", label: "Color", type: "text", bind: "color" };
const SIZE: DynField = { key: "size", label: "Size", type: "text", bind: "size" };
const EXP: DynField = { key: "expirationDate", label: "Expiration Date", type: "date", bind: "expirationDate" };

const SWORN_CLOTHING = ["Job Sweater/Jacket", "Raincoat", "Class A Shirt LS", "Class A Pants", "Duty Shirt SS", "Duty Shirt LS", "Duty Pants", "Duty Shorts", "Training Shirt SS", "Training Shirt LS", "Honor Guard Shirt LS"];
const NONSWORN_CLOTHING = ["Job Sweater/Jacket", "Raincoat", "Duty Shirt SS", "Duty Shirt LS", "Duty Pants"];
const ACCESSORY_TYPES = ["Badge Chest", "Badge Wallet", "Badge Velcro", "UFPD Ball Cap", "Winter Cap", "Necktie", "Collar Brass", "Name Plate Metal", "Name Plate Velcro"];

const AMMO_FIELDS: Record<string, DynField[]> = {
  "Handgun": [
    { key: "caliber", label: "Caliber", type: "select", options: ["9mm"] },
    { key: "ammoType", label: "Type", type: "select", options: ["Practice", "Frangible", "Duty"] },
    { key: "grainWeight", label: "Grain Weight", type: "text" },
  ],
  "Rifle": [
    { key: "caliber", label: "Caliber", type: "select", options: [".223", "5.56"] },
    { key: "ammoType", label: "Type", type: "select", options: ["Practice", "Frangible", "Duty"] },
    { key: "grainWeight", label: "Grain Weight", type: "text" },
  ],
  "Shotgun": [
    { key: "caliber", label: "Caliber", type: "select", options: ["12ga"] },
    { key: "ammoType", label: "Type", type: "select", options: ["Drag Stabilized Bean Bag (Less Lethal)", "Breaching (Lethal)"] },
  ],
  "40mm Grenade Launcher (Less Lethal)": [
    { key: "caliber", label: "Caliber", type: "select", options: ["40mm"] },
    { key: "ammoType", label: "Type", type: "select", options: ["Direct Impact Marking (Less Lethal)", "Exact Impact Marking (Less Lethal)", "OC Direct Impact Marking (Less Lethal)"] },
  ],
  "Simunitions": [
    { key: "caliber", label: "Caliber", type: "select", options: [".223", "9mm", ".38"] },
    { key: "ammoType", label: "Type", type: "select", options: ["Marking", "Non-Marking", "Loud Blank", "Quiet Blank", "Primer"] },
  ],
  "Sniper Rifle": [
    { key: "caliber", label: "Caliber", type: "select", options: [".308"] },
    { key: "ammoType", label: "Type", type: "select", options: ["Duty", "Practice"] },
    { key: "grainWeight", label: "Grain Weight", type: "text" },
  ],
};

/**
 * Returns the dynamic detail fields for the given category + subcategory.
 * Quantity, PAR, Location, Vendor, Condition, etc. are core fields rendered
 * separately and are NOT included here.
 */
export function getItemFields(category?: string | null, sub?: string | null): DynField[] {
  if (!category) return [];

  switch (category) {
    case "Firearms":
      // Same fields for all firearm subcategories.
      return [
        { key: "make", label: "Make", type: "text" },
        { key: "model", label: "Model", type: "text" },
        { key: "caliber", label: "Caliber", type: "text" },
        SERIAL(),
        { key: "lastInspected", label: "Last Inspection Date", type: "date", bind: "lastInspected" },
      ];

    case "Ammunition":
      return [
        { key: "brand", label: "Brand", type: "text" },
        { key: "model", label: "Model", type: "text" },
        ...(AMMO_FIELDS[sub ?? ""] ?? []),
      ];

    case "Uniforms":
      if (sub === "Sworn Duty Uniforms")
        return [{ key: "brand", label: "Brand", type: "text" }, COLOR, SIZE, { key: "clothingType", label: "Clothing Type", type: "select", options: SWORN_CLOTHING }];
      if (sub === "Non-Sworn Duty Uniforms")
        return [{ key: "brand", label: "Brand", type: "text" }, COLOR, SIZE, { key: "clothingType", label: "Clothing Type", type: "select", options: NONSWORN_CLOTHING }];
      if (sub === "Uniform Accessories")
        return [{ key: "accessoryType", label: "Accessory Type", type: "select", options: ACCESSORY_TYPES }, { key: "brand", label: "Brand", type: "text" }, COLOR, SIZE];
      return [];

    case "Less Lethal":
      if (sub === "OC Spray")
        return [{ key: "brand", label: "Brand", type: "text" }, { key: "model", label: "Model", type: "text" }, { key: "ocType", label: "Type", type: "select", options: ["Stream", "Foam", "Gel", "Gas"] }, EXP];
      if (sub === "Baton")
        return [{ key: "brand", label: "Brand", type: "text" }, { key: "model", label: "Model", type: "text" }];
      if (sub === "TASER")
        return [{ key: "brand", label: "Brand", type: "text" }, { key: "model", label: "Model", type: "text" }, SERIAL()];
      if (sub === "TASER Cartridges")
        return [{ key: "brand", label: "Brand", type: "text" }, { key: "cartridgeType", label: "Type", type: "select", options: ["3 degree", "12 degree"] }, { key: "distance", label: "Distance", type: "select", options: ["25 feet"] }, SERIAL(), EXP];
      return [];

    case "Duty Gear":
      // Same fields for all duty-gear subcategories.
      return [{ key: "brand", label: "Brand", type: "text" }, COLOR, { key: "style", label: "Style", type: "text" }, SIZE];

    case "Ballistic Vests":
      // Inner & Outer carriers share the same fields.
      return [
        { key: "brand", label: "Brand", type: "text" },
        { key: "ballistics", label: "Ballistics", type: "select", options: ["Yes", "No"] },
        { key: "frontPanelSerial", label: "Front Panel Serial Number", type: "text", showIf: (a) => a.ballistics === "Yes" },
        { key: "backPanelSerial", label: "Back Panel Serial Number", type: "text", showIf: (a) => a.ballistics === "Yes" },
      ];

    default:
      return [];
  }
}

// ------------------------------------------------------------------
// Bulk-import support: a master CSV template covering every category.
// ------------------------------------------------------------------
// Each non-bound dynamic field needs a UNIQUE CSV header across the whole
// template. The short in-form labels collide (several fields are just "Type"),
// so we assign descriptive, unambiguous headers here. `appliesTo` is a human
// hint shown in the column reference / notes so the user knows which rows to
// fill the column in for.
export type AttributeColumn = { key: string; header: string; example: string; appliesTo: string };

export const ATTRIBUTE_COLUMNS: AttributeColumn[] = [
  { key: "make",             header: "Make",                 example: "Glock",          appliesTo: "Firearms" },
  { key: "model",            header: "Model",                example: "17 Gen5",        appliesTo: "Firearms, Ammunition, Less Lethal" },
  { key: "caliber",          header: "Caliber",              example: "9mm",            appliesTo: "Firearms, Ammunition" },
  { key: "brand",            header: "Brand",                example: "",               appliesTo: "Ammunition, Uniforms, Less Lethal, Duty Gear, Ballistic Vests" },
  { key: "ammoType",         header: "Ammo Type",            example: "",               appliesTo: "Ammunition (e.g. Practice, Duty)" },
  { key: "grainWeight",      header: "Grain Weight",         example: "",               appliesTo: "Ammunition (Handgun, Rifle, Sniper)" },
  { key: "clothingType",     header: "Clothing Type",        example: "",               appliesTo: "Uniforms (Sworn / Non-Sworn)" },
  { key: "accessoryType",    header: "Accessory Type",       example: "",               appliesTo: "Uniforms (Accessories)" },
  { key: "ocType",           header: "OC Spray Type",        example: "",               appliesTo: "Less Lethal (OC Spray)" },
  { key: "cartridgeType",    header: "Cartridge Type",       example: "",               appliesTo: "Less Lethal (TASER Cartridges)" },
  { key: "distance",         header: "Cartridge Distance",   example: "",               appliesTo: "Less Lethal (TASER Cartridges)" },
  { key: "style",            header: "Style",                example: "",               appliesTo: "Duty Gear" },
  { key: "ballistics",       header: "Ballistics",           example: "",               appliesTo: "Ballistic Vests (Yes / No)" },
  { key: "frontPanelSerial", header: "Front Panel Serial",   example: "",               appliesTo: "Ballistic Vests (when Ballistics = Yes)" },
  { key: "backPanelSerial",  header: "Back Panel Serial",    example: "",               appliesTo: "Ballistic Vests (when Ballistics = Yes)" },
];

/** Lookup: attribute field key -> its unique CSV header. */
export const ATTRIBUTE_HEADER_BY_KEY: Record<string, string> =
  Object.fromEntries(ATTRIBUTE_COLUMNS.map((c) => [c.key, c.header]));

/**
 * Given a parsed CSV row and the row's category/subcategory, build the
 * attributes JSON map containing ONLY the non-bound dynamic fields that
 * apply to that category/subcategory. Irrelevant columns (left blank or
 * filled) are ignored per row, so one master template works for every type.
 */
export function buildImportAttributes(
  category?: string | null,
  sub?: string | null,
  row: Record<string, string> = {},
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of getItemFields(category, sub)) {
    if (f.bind) continue; // bound fields live on core columns, handled by caller
    const header = ATTRIBUTE_HEADER_BY_KEY[f.key] ?? f.label;
    const v = (row[header] ?? "").trim();
    if (v) out[f.key] = v;
  }
  return out;
}

/** Parse an item's stored attributes JSON into a string-keyed map. */
export function parseAttributes(raw?: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) if (v != null && v !== "") out[k] = String(v);
      return out;
    }
  } catch { /* ignore malformed */ }
  return {};
}

// Map a sized item to the officer profile size field it most likely draws from.
// Keywords are checked against the item's name + subcategory + category so the
// issue page can pre-suggest the officer's recorded size. Returns the officer's
// size string for that field, or null when there is no confident match.
export function officerSizeForItem(
  item: Pick<Item, "name" | "category" | "subcategory">,
  officer: Pick<Officer, "shirtSize" | "pantsSize" | "jacketSize" | "shoeSize" | "vestSize" | "hatSize" | "gloveSize">,
): string | null {
  const hay = `${item.name} ${item.subcategory ?? ""} ${item.category ?? ""}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => hay.includes(w));
  let size: string | null | undefined;
  if (has("glove")) size = officer.gloveSize;
  else if (has("hat", "cap")) size = officer.hatSize;
  else if (has("vest", "carrier", "armor")) size = officer.vestSize;
  else if (has("boot", "shoe", "footwear")) size = officer.shoeSize;
  else if (has("jacket", "coat", "sweater", "raincoat")) size = officer.jacketSize;
  else if (has("pant", "trouser", "short")) size = officer.pantsSize;
  else if (has("shirt")) size = officer.shirtSize;
  const trimmed = (size ?? "").trim();
  return trimmed || null;
}

/** Build a short human-readable summary of an item's dynamic attributes for list views. */
export function attributeSummary(item: Pick<Item, "category" | "subcategory" | "attributes">): string {
  const attrs = parseAttributes(item.attributes);
  const fields = getItemFields(item.category, item.subcategory).filter((f) => !f.bind);
  const parts = fields
    .map((f) => attrs[f.key])
    .filter((v): v is string => !!v);
  return parts.join(" · ");
}
