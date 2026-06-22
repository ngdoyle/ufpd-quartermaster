// Single source of truth for controlled vocabularies used across forms,
// CSV templates, and bulk-import validation.

export const RANKS = [
  "Officer",
  "Sergeant",
  "Lieutenant",
  "Captain",
  "Chief",
  "Detective",
  "Cadet",
  "PST",
  "FST",
  "NTBS",
  "Non-Sworn Support Staff",
  "PCO",
  "Co-Responder",
  "Fleet Manager",
  "Building Manager",
  "Property and Evidence Technician",
  "Victim Advocate",
] as const;

export const UNITS = [
  "Team 1 Days",
  "Team 1 Nights",
  "Team 2 Days",
  "Team 2 Nights",
  "Training",
  "Community Services",
  "Investigations",
  "Special Operations",
  "Admin",
  "Co-Responder",
  "Patrol Rifle",
  "Traffic",
  "K-9",
  "NTBS",
  "FST",
  "PST",
  "Victim Services",
  "Professional Standards",
] as const;

export const LOCATIONS = [
  "Stock Room",
  "Armory",
  "Ammo Storage",
  "DT Lab Storage",
] as const;

// Units are stored as a comma-joined string in the officers.unit text column.
// Within a CSV cell, multiple units are separated by a semicolon (;) to avoid
// colliding with CSV's comma delimiter.
export const UNIT_CSV_SEPARATOR = ";";
export const UNIT_DISPLAY_SEPARATOR = ", ";

/** Parse a stored/display unit string into an array of unit names. */
export function parseUnits(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((u) => u.trim())
    .filter(Boolean);
}

/** Join a list of unit names into the stored/display string. */
export function joinUnits(units: string[]): string {
  return units.join(UNIT_DISPLAY_SEPARATOR);
}
