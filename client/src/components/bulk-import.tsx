import { useRef, useState } from "react";
import Papa from "papaparse";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { exportCsv } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Upload, FileDown, CheckCircle2, AlertTriangle } from "lucide-react";

export type ColumnSpec = {
  /** CSV header label */
  header: string;
  /** Example value for the template's sample row */
  example: string;
  /** Short hint shown in the column reference list */
  note?: string;
};

type ImportResult = {
  created: number;
  errors: { row: number; message: string }[];
};

/**
 * Reusable CSV bulk-import dialog: download a template, upload a filled CSV,
 * preview the parsed row count, then POST to a bulk endpoint.
 *
 * `mapRow` converts a parsed CSV record (keyed by header) into the API payload.
 */
export function BulkImport({
  open,
  onOpenChange,
  title,
  endpoint,
  templateFilename,
  columns,
  mapRow,
  invalidateKeys,
  actor,
  instructions,
  sampleRows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  endpoint: string;
  templateFilename: string;
  columns: ColumnSpec[];
  mapRow: (row: Record<string, string>) => Record<string, any>;
  invalidateKeys: string[];
  actor?: string;
  instructions?: string;
  /** Optional filled example rows (keyed by header). When provided, the template
   *  ships these instead of a single auto-generated example — useful for a master
   *  template where each row demonstrates a different category. */
  sampleRows?: Record<string, string>[];
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  function reset() {
    setFileName(""); setRows([]); setParseErrors([]); setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function downloadTemplate() {
    // Normalize every row to the full column set in order, so the CSV always
    // carries all headers (exportCsv derives headers from the first row).
    const normalize = (src: Record<string, string>): Record<string, string> => {
      const out: Record<string, string> = {};
      columns.forEach((c) => { out[c.header] = src[c.header] ?? ""; });
      return out;
    };
    const rowsOut = sampleRows && sampleRows.length
      ? sampleRows.map(normalize)
      // Fallback: a single example row built from each column's example value.
      : [normalize(Object.fromEntries(columns.map((c) => [c.header, c.example])))];
    exportCsv(templateFilename, rowsOut);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (res) => {
        const cleaned = (res.data as Record<string, string>[])
          .map((r) => mapRow(r))
          .filter((r) => Object.values(r).some((v) => v !== "" && v != null));
        setRows(cleaned);
        setParseErrors(res.errors.slice(0, 5).map((er) => `Row ${er.row}: ${er.message}`));
      },
      error: (err) => {
        setParseErrors([err.message]);
        setRows([]);
      },
    });
  }

  async function doImport() {
    if (!rows.length) return;
    setImporting(true);
    try {
      const res = await apiRequest("POST", endpoint, { rows, actor });
      const data: ImportResult = await res.json();
      setResult(data);
      invalidateKeys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({
        title: `Imported ${data.created} record${data.created === 1 ? "" : "s"}`,
        description: data.errors.length ? `${data.errors.length} row(s) skipped — see details.` : undefined,
        variant: data.errors.length ? "destructive" : undefined,
      });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally { setImporting(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Download the template, fill it in, then upload it. Headers must match exactly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {instructions && (
            <p className="rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">{instructions}</p>
          )}

          {/* Column reference */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">CSV Columns</div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <span key={c.header} className="rounded-md border border-border bg-muted/40 px-2 py-1 text-xs" title={c.note}>
                  {c.header}
                </span>
              ))}
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="button-download-template">
            <FileDown className="mr-1.5 h-4 w-4" /> Download CSV Template
          </Button>

          {/* Upload */}
          <div className="rounded-lg border border-dashed border-border p-4 text-center">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" data-testid="input-csv-file" />
            <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} data-testid="button-choose-csv">
              <Upload className="mr-1.5 h-4 w-4" /> Choose CSV File
            </Button>
            {fileName && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-filename">{fileName} — {rows.length} valid row{rows.length === 1 ? "" : "s"} detected</p>}
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
              {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <div className="flex items-center gap-2 text-chart-2">
                <CheckCircle2 className="h-4 w-4" /> {result.created} record(s) imported successfully.
              </div>
              {result.errors.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-destructive"><AlertTriangle className="h-4 w-4" /> {result.errors.length} row(s) skipped:</div>
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pl-6 text-xs text-muted-foreground">
                    {result.errors.map((er, i) => <li key={i} className="list-disc">Row {er.row}: {er.message}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          <Button onClick={doImport} disabled={importing || rows.length === 0} data-testid="button-run-import">
            {importing ? "Importing…" : `Import ${rows.length || ""} Row${rows.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
