import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Camera, CameraOff, ScanLine, Keyboard, XCircle } from "lucide-react";

const REGION_ID = "qm-scanner-dialog-region";

/**
 * Reusable camera-QR scanner in a dialog. Stays open after each decode so the
 * caller can scan several codes in a row (multi-scan). `onScan` receives the raw
 * decoded string; the caller decides how to resolve it. Falls back to manual
 * entry when the camera is unavailable.
 */
export function ScannerDialog({
  open, onOpenChange, onScan, title = "Scan item", description = "Point the camera at an item QR code, or type a code, SKU, or serial number.",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onScan: (raw: string) => void;
  title?: string;
  description?: string;
}) {
  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const scannerRef = useRef<any>(null);
  // Debounce identical rapid decodes — html5-qrcode fires the callback many
  // times per second while a code is in view.
  const lastRef = useRef<{ value: string; at: number }>({ value: "", at: 0 });

  async function startCamera() {
    setCamError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(REGION_ID, { verbose: false } as any);
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded: string) => {
          const now = Date.now();
          if (decoded === lastRef.current.value && now - lastRef.current.at < 1500) return;
          lastRef.current = { value: decoded, at: now };
          onScan(decoded);
        },
        () => {},
      );
    } catch (e: any) {
      setScanning(false);
      scannerRef.current = null;
      setCamError(
        e?.message?.includes("Permission") || e?.name === "NotAllowedError"
          ? "Camera permission was denied. Enable camera access in your browser settings, or use manual entry below."
          : "Could not start the camera on this device. Use manual entry below instead.",
      );
    }
  }

  async function stopCamera() {
    const s = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (s) {
      try { await s.stop(); await s.clear(); } catch { /* ignore */ }
    }
  }

  // Tear the camera down whenever the dialog closes or unmounts.
  useEffect(() => {
    if (!open) { stopCamera(); setManual(""); setCamError(null); }
    return () => { const s = scannerRef.current; if (s) s.stop().catch(() => {}); };
  }, [open]);

  function submitManual() {
    const v = manual.trim();
    if (!v) return;
    onScan(v);
    setManual("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-scanner">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" /> {title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-md border border-border">
          <div className="relative aspect-square w-full bg-muted/40">
            <div id={REGION_ID} className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <div className="rounded-full bg-primary/10 p-4 text-primary"><ScanLine className="h-7 w-7" /></div>
                <p className="text-sm text-muted-foreground">Camera is off.</p>
                <Button size="sm" onClick={startCamera} data-testid="button-scanner-start"><Camera className="mr-2 h-4 w-4" /> Start scanner</Button>
              </div>
            )}
            {scanning && (
              <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-3">
                <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">Scanning… keep scanning to add more</span>
              </div>
            )}
          </div>
          {scanning && (
            <div className="flex items-center justify-between border-t border-border p-2.5">
              <span className="text-xs text-muted-foreground">Camera active</span>
              <Button variant="outline" size="sm" onClick={stopCamera} data-testid="button-scanner-stop"><CameraOff className="mr-2 h-4 w-4" /> Stop</Button>
            </div>
          )}
        </div>

        {camError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/10 p-2.5 text-xs text-destructive">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{camError}</span>
          </div>
        )}

        <div>
          <Label className="flex items-center gap-2 text-xs font-medium"><Keyboard className="h-3.5 w-3.5" /> Manual entry</Label>
          <div className="mt-1.5 flex gap-2">
            <Input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitManual(); }}
              placeholder="Code, SKU, or serial number"
              data-testid="input-scanner-manual"
            />
            <Button onClick={submitManual} disabled={!manual.trim()} data-testid="button-scanner-lookup">Add</Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-scanner-done">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
