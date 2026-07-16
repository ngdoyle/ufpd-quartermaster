/* ------------------------------------------------------------------ *
 * #16 Time-frame helpers. Quick presets + explicit start/end range,
 * shared by the issuance report and the custom generator.
 * ------------------------------------------------------------------ */

export type PresetKey = "all" | "7d" | "30d" | "90d" | "quarter" | "year" | "custom";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "custom", label: "Custom range" },
];

export type Range = { start: Date | null; end: Date | null };

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

/** Resolve a preset (or custom start/end strings, yyyy-mm-dd) into a concrete range. */
export function resolveRange(preset: PresetKey, customStart?: string, customEnd?: string): Range {
  const now = new Date();
  switch (preset) {
    case "all": return { start: null, end: null };
    case "7d": return { start: startOfDay(addDays(now, -6)), end: endOfDay(now) };
    case "30d": return { start: startOfDay(addDays(now, -29)), end: endOfDay(now) };
    case "90d": return { start: startOfDay(addDays(now, -89)), end: endOfDay(now) };
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      return { start: startOfDay(new Date(now.getFullYear(), q * 3, 1)), end: endOfDay(now) };
    }
    case "year": return { start: startOfDay(new Date(now.getFullYear(), 0, 1)), end: endOfDay(now) };
    case "custom": return {
      start: customStart ? startOfDay(new Date(customStart + "T00:00:00")) : null,
      end: customEnd ? endOfDay(new Date(customEnd + "T00:00:00")) : null,
    };
  }
}

function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function inRange(iso: string | null | undefined, range: Range): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return false;
  if (range.start && t < range.start.getTime()) return false;
  if (range.end && t > range.end.getTime()) return false;
  return true;
}

export function rangeLabel(preset: PresetKey, range: Range): string {
  if (preset !== "custom") return PRESETS.find((p) => p.key === preset)?.label ?? "All time";
  const f = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "…");
  if (!range.start && !range.end) return "All time";
  return `${f(range.start)} – ${f(range.end)}`;
}
