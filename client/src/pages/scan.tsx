import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp, can } from "@/lib/app-context";
import { PageHeader, StatusBadge, TypeBadge, EmptyState } from "@/components/bits";
import { fmtCurrency } from "@/lib/format";
import type { Item, Officer, ItemUnit } from "@shared/schema";
import { isDualSerialItem } from "@/components/serial-units-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Camera, CameraOff, ScanLine, Keyboard, PackageCheck, RotateCcw, XCircle } from "lucide-react";

const REGION_ID = "qm-qr-region";

/** Parse a scanned value. Accepts "QM:item:<id>", a bare number, or a SKU/serial string. */
function parseScan(raw: string): { id?: number; sku?: string } {
  const t = raw.trim();
  const m = t.match(/^QM:item:(\d+)$/i);
  if (m) return { id: Number(m[1]) };
  if (/^\d+$/.test(t)) return { id: Number(t) };
  return { sku: t };
}

export default function Scan() {
  const { user } = useApp();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: items } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: officers } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });

  const [scanning, setScanning] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [match, setMatch] = useState<Item | null>(null);
  const [notFound, setNotFound] = useState<string | null>(null);
  const scannerRef = useRef<any>(null);

  const canIssue = can.issueReturn(user?.role);
  const matchIsUnique = match?.type === "unique";
  const { data: matchUnits } = useQuery<ItemUnit[]>({
    queryKey: ["/api/items", match?.id ?? 0, "units"],
    enabled: !!matchIsUnique,
  });
  const inStockUnits = (matchUnits ?? []).filter((u) => u.status === "in_stock");
  const unitLabel = (u: ItemUnit) =>
    u.secondarySerialNumber ? `${u.serialNumber} / ${u.secondarySerialNumber}` : u.serialNumber;

  // quick-issue form
  const [officerId, setOfficerId] = useState("");
  const [unitId, setUnitId] = useState("");
  const [qty, setQty] = useState(1);
  const [issuedBy, setIssuedBy] = useState(user?.name ?? "");
  const [issuedLocation, setIssuedLocation] = useState("");
  const [signature, setSignature] = useState("");
  const [notes, setNotes] = useState("");
  const [issuing, setIssuing] = useState(false);
  // #6: issued-by, issued-location and signature are all required.
  const [triedIssue, setTriedIssue] = useState(false);
  const missingIssuedBy = !issuedBy.trim();
  const missingIssuedLocation = !issuedLocation.trim();
  const missingSignature = !signature.trim();

  function resolve(raw: string) {
    const { id, sku } = parseScan(raw);
    const list = items ?? [];
    let found: Item | undefined;
    if (id != null) found = list.find((i) => i.id === id);
    if (!found && sku) {
      const s = sku.toLowerCase();
      found = list.find(
        (i) => (i.sku ?? "").toLowerCase() === s || (i.serialNumber ?? "").toLowerCase() === s
      );
    }
    if (found) {
      setMatch(found);
      setNotFound(null);
      setOfficerId("");
      setUnitId("");
      setQty(1);
      setIssuedBy(user?.name ?? "");
      setIssuedLocation("");
      setSignature("");
      setNotes("");
      setTriedIssue(false);
      stopCamera();
    } else {
      setMatch(null);
      setNotFound(raw);
    }
  }

  async function startCamera() {
    setCamError(null);
    setNotFound(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(REGION_ID, { verbose: false } as any);
      scannerRef.current = scanner;
      setScanning(true);
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded: string) => {
          resolve(decoded);
        },
        () => {}
      );
    } catch (e: any) {
      setScanning(false);
      scannerRef.current = null;
      setCamError(
        e?.message?.includes("Permission") || e?.name === "NotAllowedError"
          ? "Camera permission was denied. Enable camera access in your browser settings, or use manual entry below."
          : "Could not start the camera on this device. Use manual entry below instead."
      );
    }
  }

  async function stopCamera() {
    const s = scannerRef.current;
    scannerRef.current = null;
    setScanning(false);
    if (s) {
      try {
        await s.stop();
        await s.clear();
      } catch {
        /* ignore */
      }
    }
  }

  useEffect(() => {
    return () => {
      // best-effort cleanup on unmount
      const s = scannerRef.current;
      if (s) {
        s.stop().catch(() => {});
      }
    };
  }, []);

  async function doIssue() {
    if (!match) return;
    if (!officerId) return toast({ title: "Select an officer", variant: "destructive" });
    if (matchIsUnique && inStockUnits.length === 0)
      return toast({ title: "No serial in stock", description: "Add an available unit on the Inventory page first.", variant: "destructive" });
    if (matchIsUnique && inStockUnits.length > 0 && !unitId)
      return toast({ title: "Select a serial/unit to issue", variant: "destructive" });
    if (missingIssuedBy || missingIssuedLocation || missingSignature) {
      setTriedIssue(true);
      return toast({ title: "Complete the required fields", description: "Issued by, issued location and recipient signature are required.", variant: "destructive" });
    }
    setIssuing(true);
    try {
      await apiRequest("POST", "/api/issue", {
        itemId: match.id,
        officerId: Number(officerId),
        quantity: qty,
        itemUnitId: matchIsUnique && unitId ? Number(unitId) : null,
        issuedBy: issuedBy.trim(),
        issuedLocation: issuedLocation.trim(),
        signature: signature.trim(),
        notes: notes.trim() || undefined,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/items"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/items", match.id, "units"] }),
      ]);
      toast({ title: "Item issued", description: `${match.name} issued successfully.` });
      setMatch(null);
    } catch (e: any) {
      toast({ title: "Could not issue", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setIssuing(false);
    }
  }

  const issuable =
    match && match.status === "in_stock" && match.quantity > 0 && match.type !== "consumable"
      ? true
      : match && match.type === "consumable" && match.quantity > 0
      ? true
      : false;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Scan"
        subtitle="Point your camera at an item QR code, or enter a code, SKU, or serial number manually."
      />

      {/* Scanner / camera card */}
      <Card className="overflow-hidden p-0">
        <div className="relative aspect-square w-full bg-muted/40">
          <div id={REGION_ID} className="absolute inset-0 [&_video]:h-full [&_video]:w-full [&_video]:object-cover" />
          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="rounded-full bg-primary/10 p-4 text-primary">
                <ScanLine className="h-8 w-8" />
              </div>
              <p className="text-sm text-muted-foreground">
                Camera is off. Start the scanner to read an item QR code.
              </p>
              <Button onClick={startCamera} data-testid="button-start-camera">
                <Camera className="mr-2 h-4 w-4" />
                Start scanner
              </Button>
            </div>
          )}
          {scanning && (
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-4">
              <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
                Scanning… align the QR code in view
              </span>
            </div>
          )}
        </div>
        {scanning && (
          <div className="flex items-center justify-between border-t border-border p-3">
            <span className="text-xs text-muted-foreground">Camera active</span>
            <Button variant="outline" size="sm" onClick={stopCamera} data-testid="button-stop-camera">
              <CameraOff className="mr-2 h-4 w-4" />
              Stop
            </Button>
          </div>
        )}
      </Card>

      {camError && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{camError}</span>
        </div>
      )}

      {/* Manual entry */}
      <Card className="mt-4 p-4">
        <Label className="flex items-center gap-2 text-sm font-medium">
          <Keyboard className="h-4 w-4" /> Manual entry
        </Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim()) resolve(manual);
            }}
            placeholder="e.g. QM:item:5, an item ID, SKU, or serial number"
            data-testid="input-manual-code"
          />
          <Button onClick={() => manual.trim() && resolve(manual)} disabled={!manual.trim()} data-testid="button-lookup-manual">
            Look up
          </Button>
        </div>
      </Card>

      {/* Not found */}
      {notFound && (
        <div className="mt-4">
          <EmptyState
            title="No matching item"
            hint={`Nothing matched "${notFound}". Check the code, SKU, or serial number and try again.`}
          />
        </div>
      )}

      {/* Match result */}
      {match && (
        <Card className="mt-4 p-4" data-testid={`card-match-${match.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold" data-testid="text-match-name">{match.name}</h3>
                <TypeBadge type={match.type} />
                <StatusBadge status={match.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {match.category}
                {match.sku ? ` · SKU ${match.sku}` : ""}
                {match.serialNumber ? ` · S/N ${match.serialNumber}` : ""}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div><span className="text-muted-foreground">Qty: </span>{match.quantity}</div>
                {match.size && <div><span className="text-muted-foreground">Size: </span>{match.size}</div>}
                {match.location && <div><span className="text-muted-foreground">Location: </span>{match.location}</div>}
                {match.unitCost != null && <div><span className="text-muted-foreground">Unit: </span>{fmtCurrency(match.unitCost)}</div>}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setMatch(null)} data-testid="button-clear-match">
              <RotateCcw className="mr-2 h-4 w-4" /> Scan another
            </Button>
          </div>

          {/* Quick issue */}
          {canIssue ? (
            issuable ? (
              <div className="mt-4 border-t border-border pt-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <PackageCheck className="h-4 w-4 text-primary" /> Quick issue
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Issue To</Label>
                    <Select value={officerId} onValueChange={setOfficerId}>
                      <SelectTrigger className="mt-1" data-testid="select-officer">
                        <SelectValue placeholder="Select recipient…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(officers ?? [])
                          .filter((o) => o.status === "active")
                          .map((o) => (
                            <SelectItem key={o.id} value={String(o.id)}>
                              {o.firstName} {o.lastName} (#{o.badgeNumber})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {matchIsUnique && (
                    <div className="sm:col-span-2">
                      <Label className="text-xs">{isDualSerialItem(match) ? "Vest (panel serials)" : "Serial / Unit"}</Label>
                      {inStockUnits.length === 0 ? (
                        <p className="mt-1 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive" data-testid="text-no-units">
                          No available units in stock. Add a serialized unit on the Inventory page before issuing.
                        </p>
                      ) : (
                        <Select value={unitId} onValueChange={setUnitId}>
                          <SelectTrigger className="mt-1" data-testid="select-unit"><SelectValue placeholder="Select serial to issue…" /></SelectTrigger>
                          <SelectContent>
                            {inStockUnits.map((u) => <SelectItem key={u.id} value={String(u.id)}>{unitLabel(u)}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Quantity</Label>
                    <Input
                      type="number"
                      min={1}
                      max={match.quantity}
                      value={matchIsUnique ? 1 : qty}
                      disabled={matchIsUnique}
                      onChange={(e) => setQty(Math.max(1, Math.min(match.quantity, Number(e.target.value) || 1)))}
                      className="mt-1"
                      data-testid="input-qty"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Issued by <span className="text-destructive">*</span></Label>
                    <Input
                      value={issuedBy}
                      onChange={(e) => setIssuedBy(e.target.value)}
                      placeholder="Who is issuing this item"
                      className="mt-1"
                      data-testid="input-issued-by"
                    />
                    {triedIssue && missingIssuedBy && <p className="mt-1 text-xs text-destructive" data-testid="error-issued-by">Issued by is required.</p>}
                  </div>
                  <div>
                    <Label className="text-xs">Issued location <span className="text-destructive">*</span></Label>
                    <Input
                      value={issuedLocation}
                      onChange={(e) => setIssuedLocation(e.target.value)}
                      placeholder="Given in person, locker #, front desk…"
                      className="mt-1"
                      data-testid="input-issued-location"
                    />
                    {triedIssue && missingIssuedLocation && <p className="mt-1 text-xs text-destructive" data-testid="error-issued-location">Issued location is required.</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Acknowledgement signature (type full name) <span className="text-destructive">*</span></Label>
                    <Input
                      value={signature}
                      onChange={(e) => setSignature(e.target.value)}
                      placeholder="Officer acknowledges receipt"
                      className="mt-1"
                      data-testid="input-signature"
                    />
                    {triedIssue && missingSignature && <p className="mt-1 text-xs text-destructive" data-testid="error-signature">Recipient signature is required.</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Notes (optional)</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      className="mt-1"
                      data-testid="input-notes"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button onClick={doIssue} disabled={issuing} data-testid="button-quick-issue">
                    {issuing ? "Issuing…" : "Issue item"}
                  </Button>
                  <Button variant="outline" onClick={() => navigate("/issue")} data-testid="button-full-issue">
                    Open full issue form
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
                This item is not available to issue right now ({match.status === "issued" ? "currently issued" : match.status}).
                {" "}
                <button className="font-medium text-primary underline" onClick={() => navigate("/inventory")} data-testid="link-view-inventory">
                  View in inventory
                </button>
                .
              </div>
            )
          ) : (
            <div className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
              You do not have permission to issue items. Item details are shown above for reference.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
