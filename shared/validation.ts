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
