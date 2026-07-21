export function fmtDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtCurrency(n?: number | null) {
  return (n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return Math.ceil((dt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function relativeDays(d?: string | null): string {
  const n = daysUntil(d);
  if (n === null) return "—";
  if (n < 0) return `${Math.abs(n)}d overdue`;
  if (n === 0) return "today";
  return `in ${n}d`;
}

// #12: every generated report artifact is named `YYYY-MM-DD_REPORT TITLE.ext`.
// Same sanitize approach as the receipt filenames (client/src/lib/receipt.ts):
// keep spaces, strip characters invalid on Windows/macOS/Linux + control chars.
function reportDate(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function sanitizeReportTitle(s: string): string {
  return s.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "").replace(/\s+/g, " ").trim();
}
export function reportFilename(title: string, ext: string): string {
  const t = sanitizeReportTitle(title) || "Report";
  return `${reportDate()}_${t}.${ext.replace(/^\./, "")}`;
}

/** Build a CSV string and trigger a browser download (works in sandboxed iframe via Blob). */
export function exportCsv(filename: string, rows: Record<string, any>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: any) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Neutralize spreadsheet formula injection: prefix a quote when a cell
    // starts with =, +, @, tab, CR, or a minus that isn't a plain number.
    if (typeof v !== "number" && /^[=+@\t\r]/.test(s)) s = `'${s}`;
    else if (typeof v !== "number" && s.startsWith("-") && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
