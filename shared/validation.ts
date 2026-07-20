// Shared validation + normalization helpers used by both the client forms and
// the server route guards so the two never drift. All rules here reflect the
// USER-APPROVED validation spec (Batch 4 #19).

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(s?: string | null): boolean {
  const v = (s ?? "").trim();
  return EMAIL_RE.test(v);
}

/** Digits only. */
export function phoneDigits(s?: string | null): string {
  return (s ?? "").replace(/\D/g, "");
}

/** A phone is valid when it has exactly 10 US digits. */
export function isValidPhone(s?: string | null): boolean {
  return phoneDigits(s).length === 10;
}

/**
 * Canonical stored form: "(XXX) XXX-XXXX" when exactly 10 digits, otherwise the
 * input is returned trimmed and untouched (never destroy non-conforming data —
 * legacy rows may hold extensions or intl numbers).
 */
export function normalizePhone(s?: string | null): string {
  const raw = (s ?? "").trim();
  const d = phoneDigits(raw);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

/**
 * Progressive formatter for on-the-fly typing. Caps at 10 digits and formats
 * as far as the user has typed so the field reads naturally while editing.
 */
export function formatPhoneInput(s?: string | null): string {
  const d = phoneDigits(s).slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Whole number >= 0. Accepts number or numeric string. */
export function isWholeNonNeg(v: unknown): boolean {
  if (v === "" || v === null || v === undefined) return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0;
}

/** Dollars >= 0 with at most two decimal places. */
export function isMoneyNonNeg(v: unknown): boolean {
  if (v === "" || v === null || v === undefined) return true; // optional field
  const s = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return false;
  return Number(s) >= 0;
}

/* ------------------------------------------------------------------ */
/* Item condition vocabulary (Batch 2 #10)                             */
/* ------------------------------------------------------------------ */
// The ONLY allowed condition values, verbatim ALL-CAPS. Shared by every
// condition dropdown (inventory, serialized units, issue/return) and the
// server-side validation so the two can never drift.
export const CONDITIONS = [
  "NEW", "LIKE NEW", "GOOD", "FAIR", "DAMAGED", "MAINTENANCE", "RETIRED",
] as const;
export type Condition = (typeof CONDITIONS)[number];

const CONDITION_SET = new Set<string>(CONDITIONS);

/** True when the value is one of the allowed ALL-CAPS conditions. */
export function isValidCondition(s?: string | null): boolean {
  return CONDITION_SET.has(String(s ?? "").trim());
}

// Map legacy mixed-case values onto the new vocabulary. "Poor" has no direct
// equivalent in the new list and is folded into FAIR (its nearest neighbour).
const LEGACY_CONDITION_MAP: Record<string, Condition> = {
  "new": "NEW",
  "like new": "LIKE NEW",
  "good": "GOOD",
  "fair": "FAIR",
  "poor": "FAIR",
  "damaged": "DAMAGED",
  "maintenance": "MAINTENANCE",
  "retired": "RETIRED",
};

/** Normalize any legacy/mixed-case condition to the allowed ALL-CAPS value. */
export function normalizeCondition(s?: string | null): string {
  const raw = String(s ?? "").trim();
  if (CONDITION_SET.has(raw)) return raw;
  return LEGACY_CONDITION_MAP[raw.toLowerCase()] ?? raw;
}
