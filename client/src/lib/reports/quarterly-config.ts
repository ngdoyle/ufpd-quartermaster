/**
 * Quarterly Operational Readiness weapon groups.
 *
 * Keep the membership explicit: these groups are intentionally based on
 * inventory item names (not firearm subcategories). Update this file when the
 * Training Division's authorized weapon list changes.
 */
export const OPERATIONAL_READINESS_WEAPON_GROUPS = [
  {
    title: "Rifles",
    itemNames: ["Daniel Defense DDM4 V7", "Accuracy Intl AT308"],
  },
  {
    title: "Departmental Handguns",
    itemNames: ["Glock 45 MOS w/ AIMPOINT ACRO P2"],
  },
  {
    title: "Departmental Shotguns",
    itemNames: ["Mossberg 590A1 Shotgun (LLIM)"],
  },
] as const;

export const INSPECTION_SECTIONS = [
  { title: "Firearms", category: "Firearms" },
  { title: "Ammunition", category: "Ammunition" },
  { title: "Less Lethal", category: "Less Lethal" },
  {
    title: "Training Equipment",
    category: "Training Gear",
    subcategories: ["Inert Weapons", "Mats/Pads"],
  },
  {
    title: "VR",
    category: "Training Gear",
    subcategories: ["VR Gear"],
  },
] as const;
