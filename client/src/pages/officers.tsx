import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp, can } from "@/lib/app-context";
import { PageHeader, Pill, StatusBadge, EmptyState } from "@/components/bits";
import { fmtDate, fmtDateTime, relativeDays, exportCsv, reportFilename } from "@/lib/format";
import type { Officer, Item, Assignment, ItemUnit } from "@shared/schema";
import { isDualSerialItem } from "@/components/serial-units-dialog";
import { downloadIssueReceipt } from "@/lib/receipt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Pencil, Download, Upload, Shirt, Mail, Phone, Package, LayoutGrid, List, ArrowUpAZ, ArrowDownAZ, Trash2 } from "lucide-react";
import { MultiSelect } from "@/components/multi-select";
import { BulkImport, type ColumnSpec } from "@/components/bulk-import";
import { RANKS, UNITS, parseUnits, joinUnits, UNIT_CSV_SEPARATOR } from "@/lib/constants";
import { isValidEmail, isValidPhone, normalizePhone, formatPhoneInput } from "@shared/validation";
import { AlertTriangle } from "lucide-react";
const blank = (): Partial<Officer> => ({
  badgeNumber: "", firstName: "", lastName: "", rank: "Officer", unit: "", email: "", phone: "",
  status: "active", hireDate: "", shirtSize: "", pantsSize: "", jacketSize: "", shoeSize: "",
  vestSize: "", hatSize: "", gloveSize: "", notes: "",
});

// Required set + format checks per the USER-APPROVED #19 spec. `missing` are
// empty required fields; `invalid` are present values that fail a format rule.
function fieldErrors(f: Partial<Officer>, business: boolean) {
  const missing: Record<string, string> = {};
  const invalid: Record<string, string> = {};
  const has = (v: unknown) => String(v ?? "").trim().length > 0;
  if (business) {
    if (!has(f.firstName)) missing.firstName = "Business name";
  } else {
    if (!has(f.firstName)) missing.firstName = "First name";
    if (!has(f.lastName)) missing.lastName = "Last name";
    if (!has(f.badgeNumber)) missing.badgeNumber = "Badge number";
    if (!has(f.unit)) missing.unit = "Rank/unit";
    if (!has(f.email)) missing.email = "Email";
    if (!has(f.phone)) missing.phone = "Phone";
  }
  if (has(f.email) && !isValidEmail(f.email)) invalid.email = "Enter a valid email address";
  if (has(f.phone) && !isValidPhone(f.phone)) invalid.phone = "Enter a 10-digit US phone number";
  return { missing, invalid };
}

export default function Officers() {
  const { user } = useApp();
  const { toast } = useToast();
  const editable = can.manageOfficers(user?.role);
  const isAdmin = user?.role === "admin";
  const { data: officers, isLoading } = useQuery<Officer[]>({ queryKey: ["/api/officers"] });
  const { data: items } = useQuery<Item[]>({ queryKey: ["/api/items"] });
  const { data: assignments } = useQuery<Assignment[]>({ queryKey: ["/api/assignments"] });

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"person" | "business">("person");
  const [form, setForm] = useState<Partial<Officer> | null>(null);
  const [detail, setDetail] = useState<Officer | null>(null);
  const [saving, setSaving] = useState(false);
  const [triedSave, setTriedSave] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<Officer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [view, setView] = useState<"cards" | "rows">("cards");
  const [rankFilter, setRankFilter] = useState("all");
  const [unitFilter, setUnitFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"lastName" | "firstName" | "rank" | "badgeNumber" | "unit">("lastName");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    if (!officers) return [];
    const t = q.toLowerCase();
    const matched = officers.filter((o) => {
      if ((o.type ?? "person") !== tab) return false;
      if (t && ![o.firstName, o.lastName, o.badgeNumber, o.unit, o.rank].some((f) => f?.toLowerCase().includes(t))) return false;
      if (rankFilter !== "all" && o.rank !== rankFilter) return false;
      if (unitFilter !== "all" && !parseUnits(o.unit).includes(unitFilter)) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      return true;
    });
    const cmp = (a: Officer, b: Officer) => {
      let r: number;
      if (sortKey === "rank") {
        const ai = RANKS.indexOf(a.rank as any), bi = RANKS.indexOf(b.rank as any);
        r = (ai === -1 ? RANKS.length : ai) - (bi === -1 ? RANKS.length : bi);
      } else if (sortKey === "badgeNumber") {
        const an = Number(a.badgeNumber), bn = Number(b.badgeNumber);
        r = (a.badgeNumber !== "" && b.badgeNumber !== "" && !isNaN(an) && !isNaN(bn))
          ? an - bn
          : (a.badgeNumber ?? "").localeCompare(b.badgeNumber ?? "", undefined, { sensitivity: "base" });
      } else {
        r = (a[sortKey] ?? "").localeCompare(b[sortKey] ?? "", undefined, { sensitivity: "base" });
      }
      return sortAsc ? r : -r;
    };
    return [...matched].sort(cmp);
  }, [officers, q, tab, rankFilter, unitFilter, statusFilter, sortKey, sortAsc]);

  const isBiz = (o: { type?: string | null }) => (o.type ?? "person") === "business";
  const dispName = (o: Officer) => isBiz(o) ? o.firstName : `${o.firstName} ${o.lastName}`;
  const counts = useMemo(() => {
    let person = 0, business = 0;
    for (const o of officers ?? []) (o.type ?? "person") === "business" ? business++ : person++;
    return { person, business };
  }, [officers]);

  function newBusiness(): Partial<Officer> {
    return { type: "business", firstName: "", lastName: "", badgeNumber: "", rank: null, unit: "", email: "", phone: "", status: "active", notes: "" };
  }

  const itemName = (id: number) => items?.find((i) => i.id === id)?.name ?? `Item #${id}`;
  const itemById = (id: number) => items?.find((i) => i.id === id);
  const activeFor = (officerId: number) => (assignments ?? []).filter((a) => a.officerId === officerId && a.status === "active");

  const formBiz = isBiz(form ?? { type: "person" });
  const formEditing = !!form?.id;
  const formErrs = form ? fieldErrors(form, formBiz) : { missing: {}, invalid: {} };
  const errFor = (k: string): string | undefined => {
    if (!triedSave) return undefined;
    if (formErrs.invalid[k] && (formEditing ? touched[k] : true)) return formErrs.invalid[k];
    if (!formEditing && formErrs.missing[k]) return `${formErrs.missing[k]} is required`;
    return undefined;
  };
  const legacyIssues = formEditing
    ? [
        ...Object.values(formErrs.missing),
        ...Object.entries(formErrs.invalid).filter(([k]) => !touched[k]).map(([, v]) => v),
      ]
    : [];
  const markTouched = (k: string) => setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const closeForm = () => { setForm(null); setTriedSave(false); setTouched({}); };

  async function save() {
    const biz = isBiz(form ?? { type: "person" });
    const isEditing = !!form?.id;
    setTriedSave(true);
    const { missing, invalid } = fieldErrors(form ?? {}, biz);
    if (!isEditing) {
      // CREATE — enforce the full required set + formats strictly.
      const firstMissing = Object.values(missing)[0];
      if (firstMissing) return toast({ title: `${firstMissing} is required`, variant: "destructive" });
      const firstInvalid = Object.values(invalid)[0];
      if (firstInvalid) return toast({ title: firstInvalid, variant: "destructive" });
    } else {
      // EDIT — never lock out legacy records: only block a bad format the user
      // actually typed this session. Missing/legacy issues surface as a warning.
      const firstTouchedInvalid = Object.entries(invalid).find(([k]) => touched[k]);
      if (firstTouchedInvalid) return toast({ title: firstTouchedInvalid[1], variant: "destructive" });
    }
    setSaving(true);
    try {
      const normPhone = normalizePhone(form?.phone);
      const payload = biz
        ? { ...form, phone: normPhone, lastName: form?.lastName ?? "", badgeNumber: form?.badgeNumber ?? "", rank: null, actor: user?.name }
        : { ...form, phone: normPhone, actor: user?.name };
      if (form?.id) await apiRequest("PATCH", `/api/officers/${form.id}`, payload);
      else await apiRequest("POST", "/api/officers", payload);
      queryClient.invalidateQueries({ queryKey: ["/api/officers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      toast({ title: form?.id ? (biz ? "Business updated" : "Officer updated") : (biz ? "Business added" : "Officer added") });
      closeForm();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `/api/officers/${deleteTarget.id}?actor=${encodeURIComponent(user?.name ?? "")}`);
      queryClient.invalidateQueries({ queryKey: ["/api/officers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/assignments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      if (detail?.id === deleteTarget.id) setDetail(null);
      toast({ title: "Officer deleted" });
      setDeleteTarget(null);
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setDeleting(false); }
  }

  function doExport() {
    exportCsv(reportFilename("Personnel", "csv"), filtered.map((o) => ({
      Badge: o.badgeNumber, Last: o.lastName, First: o.firstName, Rank: o.rank, Unit: o.unit,
      Email: o.email, Phone: o.phone, Status: o.status, Shirt: o.shirtSize, Pants: o.pantsSize,
      Jacket: o.jacketSize, Shoe: o.shoeSize, Vest: o.vestSize, Hat: o.hatSize, Glove: o.gloveSize,
    })));
  }

  return (
    <div>
      <PageHeader title="Personnel Roster" subtitle={`${counts.person} personnel · ${counts.business} businesses`}
        actions={<>
          <Button variant="outline" size="sm" onClick={doExport} data-testid="button-export-officers"><Download className="mr-1.5 h-4 w-4" /> Export CSV</Button>
          {editable && tab === "person" && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} data-testid="button-import-officers"><Upload className="mr-1.5 h-4 w-4" /> Bulk Import</Button>}
          {editable && tab === "person" && <Button size="sm" onClick={() => setForm(blank())} data-testid="button-add-officer"><Plus className="mr-1.5 h-4 w-4" /> Add Officer</Button>}
          {editable && tab === "business" && <Button size="sm" onClick={() => setForm(newBusiness())} data-testid="button-add-business"><Plus className="mr-1.5 h-4 w-4" /> Add Business</Button>}
        </>} />

      <div className="mb-4 inline-flex rounded-md border border-border p-0.5">
        <Button variant={tab === "person" ? "default" : "ghost"} size="sm" className="rounded-sm" onClick={() => setTab("person")} data-testid="tab-personnel">Personnel</Button>
        <Button variant={tab === "business" ? "default" : "ghost"} size="sm" className="rounded-sm" onClick={() => setTab("business")} data-testid="tab-businesses">Businesses</Button>
      </div>

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search by name, badge, unit…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="input-search-officers" />
          </div>

          {tab === "person" && <Select value={rankFilter} onValueChange={setRankFilter}>
            <SelectTrigger className="h-9 w-[130px]" data-testid="select-filter-rank"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Ranks</SelectItem>
              {RANKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>}

          {tab === "person" && <Select value={unitFilter} onValueChange={setUnitFilter}>
            <SelectTrigger className="h-9 w-[130px]" data-testid="select-filter-unit"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Units</SelectItem>
              {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
            </SelectContent>
          </Select>}

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[120px]" data-testid="select-filter-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
              <SelectTrigger className="h-9 w-[140px]" data-testid="select-sort-officers"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lastName">Last Name</SelectItem>
                <SelectItem value="firstName">First Name</SelectItem>
                <SelectItem value="rank">Rank</SelectItem>
                <SelectItem value="badgeNumber">ID / Badge #</SelectItem>
                <SelectItem value="unit">Unit</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSortAsc((v) => !v)}
              aria-label={sortAsc ? "Sort ascending" : "Sort descending"} data-testid="button-sort-direction">
              {sortAsc ? <ArrowUpAZ className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
            </Button>
          </div>

          <div className="flex items-center rounded-md border border-border">
            <Button variant={view === "cards" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none"
              onClick={() => setView("cards")} aria-label="Card view" data-testid="button-view-cards">
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={view === "rows" ? "default" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none"
              onClick={() => setView("rows")} aria-label="Table view" data-testid="button-view-rows">
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState title={tab === "business" ? "No businesses found" : "No officers found"} hint={tab === "business" ? "Add a business/vendor to issue gear to them" : "No officers match your filters"} />
      ) : view === "rows" ? (
        <Card className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Badge #</TableHead>
                <TableHead>Rank</TableHead>
                <TableHead>Unit(s)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Items Issued</TableHead>
                {isAdmin && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => setDetail(o)} data-testid={`row-officer-${o.id}`}>
                  <TableCell className="font-medium">{dispName(o)}</TableCell>
                  <TableCell className="text-muted-foreground">{o.badgeNumber ? `#${o.badgeNumber}` : "—"}</TableCell>
                  <TableCell>{isBiz(o) ? "Business" : o.rank}</TableCell>
                  <TableCell className="text-muted-foreground">{o.unit || "—"}</TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-right">{activeFor(o.id).length}</TableCell>
                  {isAdmin && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(o); }}
                        aria-label="Delete officer" data-testid={`button-delete-officer-${o.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((o) => {
            const issued = activeFor(o.id);
            return (
              <Card key={o.id} className="p-4 cursor-pointer hover-elevate" onClick={() => setDetail(o)} data-testid={`card-officer-${o.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary text-sm font-semibold">
                      {o.firstName[0]}{isBiz(o) ? "" : o.lastName[0]}
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium leading-tight truncate">{dispName(o)}</p>
                      <p className="text-xs text-muted-foreground">{isBiz(o) ? "Business/Vendor" : `#${o.badgeNumber} · ${o.rank}`}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <StatusBadge status={o.status} />
                    {isAdmin && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(o); }}
                        aria-label="Delete officer" data-testid={`button-delete-officer-${o.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{o.unit || "—"}</span>
                  <Pill tone={issued.length ? "blue" : "gray"}>{issued.length} items issued</Pill>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail sheet */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/12 text-primary text-base font-semibold">
                    {detail.firstName[0]}{isBiz(detail) ? "" : detail.lastName[0]}
                  </span>
                  <span>
                    <span className="block">{dispName(detail)}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {isBiz(detail) ? `Business/Vendor${detail.unit ? ` · ${detail.unit}` : ""}` : `#${detail.badgeNumber} · ${detail.rank} · ${detail.unit}`}
                    </span>
                  </span>
                </SheetTitle>
              </SheetHeader>

              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {detail.email && <a href={`mailto:${detail.email}`} className="flex items-center gap-2 text-primary"><Mail className="h-4 w-4" />{detail.email}</a>}
                  {detail.phone && <span className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" />{detail.phone}</span>}
                </div>
                {!isBiz(detail) && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Hire date</span><span>{fmtDate(detail.hireDate)}</span>
                  </div>
                )}

                {/* Sizing (personnel only) */}
                {!isBiz(detail) && (
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Shirt className="h-4 w-4 text-primary" /> Uniform & Gear Sizing</div>
                    <div className="grid grid-cols-3 gap-2">
                      {([["Shirt", detail.shirtSize], ["Pants", detail.pantsSize], ["Jacket", detail.jacketSize],
                         ["Shoe", detail.shoeSize], ["Vest", detail.vestSize], ["Hat", detail.hatSize],
                         ["Glove", detail.gloveSize]] as [string, string | null][]).map(([k, v]) => (
                        <div key={k} className="rounded-md border border-border bg-muted/40 p-2 text-center">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
                          <div className="text-sm font-medium">{v || "—"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Issued items */}
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4 text-primary" /> Currently Issued</div>
                  {activeFor(detail.id).length === 0 ? <EmptyState title="No items issued" /> : (
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {activeFor(detail.id).map((a) => {
                        const overdue = a.dueDate && new Date(a.dueDate) < new Date();
                        const it = itemById(a.itemId);
                        return (
                          <li key={a.id} className="px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{a.quantity}× {itemName(a.itemId)}</span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {a.dueDate ? <Pill tone={overdue ? "red" : "gray"}>{relativeDays(a.dueDate)}</Pill> : <Pill tone="gray">no due date</Pill>}
                                <ReprintReceiptButton assignment={a} item={it} officer={detail} />
                              </div>
                            </div>
                            {(a.issuedBy || a.issuedLocation) && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {a.issuedBy ? `Issued by ${a.issuedBy}` : ""}
                                {a.issuedBy && a.issuedLocation ? " · " : ""}
                                {a.issuedLocation ? `at ${a.issuedLocation}` : ""}
                              </p>
                            )}
                            {it?.type === "unique" && (
                              <AssignmentUnitControl assignment={a} item={it} editable={editable} actor={user?.name} />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {detail.notes && <div className="rounded-md bg-muted/40 p-3 text-sm"><span className="text-muted-foreground">Notes: </span>{detail.notes}</div>}

                {editable && <Button className="w-full" onClick={() => { setForm(detail); setDetail(null); }}><Pencil className="mr-1.5 h-4 w-4" /> Edit {isBiz(detail) ? "Business" : "Officer"}</Button>}
                {isAdmin && (
                  <Button variant="destructive" className="w-full" onClick={() => setDeleteTarget(detail)} data-testid={`button-delete-officer-detail-${detail.id}`}>
                    <Trash2 className="mr-1.5 h-4 w-4" /> Delete {isBiz(detail) ? "Business" : "Officer"}
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Add/edit dialog */}
      <Dialog open={!!form} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? (isBiz(form) ? "Edit Business" : "Edit Officer") : (isBiz(form ?? { type: "person" }) ? "Add Business" : "Add Officer")}</DialogTitle>
            <DialogDescription>{isBiz(form ?? { type: "person" }) ? "Business/vendor you can issue equipment to (e.g. for maintenance)." : "Personnel profile including uniform and gear sizing."}</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span><span className="text-destructive">*</span> required</span>
            </div>
          )}
          {legacyIssues.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-chart-3/40 bg-chart-3/10 p-2.5 text-xs text-foreground" data-testid="text-legacy-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-chart-3" />
              <span>This record is missing or has outdated required info: {legacyIssues.join(", ")}. You can still save, but please complete it when possible.</span>
            </div>
          )}
          {form && isBiz(form) ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field className="sm:col-span-2" label="Business name" required error={errFor("firstName")}><Input value={form.firstName ?? ""} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-business-name" /></Field>
              <Field label="Contact person"><Input value={form.unit ?? ""} onChange={(e) => setForm({ ...form, unit: e.target.value })} data-testid="input-business-contact" /></Field>
              <Field label="Status">
                <Select value={form.status ?? "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="Email" error={errFor("email")}><Input value={form.email ?? ""} onChange={(e) => { markTouched("email"); setForm({ ...form, email: e.target.value }); }} data-testid="input-business-email" /></Field>
              <Field label="Phone" error={errFor("phone")}><Input value={form.phone ?? ""} onChange={(e) => { markTouched("phone"); setForm({ ...form, phone: formatPhoneInput(e.target.value) }); }} data-testid="input-business-phone" /></Field>
              <Field className="sm:col-span-2" label="Address / notes"><Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} data-testid="input-business-notes" /></Field>
            </div>
          ) : form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Badge #" required error={errFor("badgeNumber")}><Input value={form.badgeNumber ?? ""} onChange={(e) => setForm({ ...form, badgeNumber: e.target.value })} data-testid="input-badge" /></Field>
              <Field label="Status">
                <Select value={form.status ?? "active"} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </Field>
              <Field label="First name" required error={errFor("firstName")}><Input value={form.firstName ?? ""} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-first" /></Field>
              <Field label="Last name" required error={errFor("lastName")}><Input value={form.lastName ?? ""} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="input-last" /></Field>
              <Field label="Rank" required>
                <Select value={form.rank ?? "Officer"} onValueChange={(v) => setForm({ ...form, rank: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RANKS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Unit" required error={errFor("unit")}><MultiSelect options={UNITS} value={parseUnits(form.unit)} onChange={(units) => setForm({ ...form, unit: joinUnits(units) })} placeholder="Select units…" testId="unit" /></Field>
              <Field label="Email" required error={errFor("email")}><Input value={form.email ?? ""} onChange={(e) => { markTouched("email"); setForm({ ...form, email: e.target.value }); }} data-testid="input-email" /></Field>
              <Field label="Phone" required error={errFor("phone")}><Input value={form.phone ?? ""} onChange={(e) => { markTouched("phone"); setForm({ ...form, phone: formatPhoneInput(e.target.value) }); }} data-testid="input-phone" /></Field>
              <Field label="Hire date"><Input type="date" value={(form.hireDate ?? "").slice(0, 10)} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} /></Field>
              <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sizing</div>
              <Field label="Shirt"><Input value={form.shirtSize ?? ""} onChange={(e) => setForm({ ...form, shirtSize: e.target.value })} /></Field>
              <Field label="Pants"><Input value={form.pantsSize ?? ""} onChange={(e) => setForm({ ...form, pantsSize: e.target.value })} /></Field>
              <Field label="Jacket"><Input value={form.jacketSize ?? ""} onChange={(e) => setForm({ ...form, jacketSize: e.target.value })} /></Field>
              <Field label="Shoe"><Input value={form.shoeSize ?? ""} onChange={(e) => setForm({ ...form, shoeSize: e.target.value })} /></Field>
              <Field label="Vest"><Input value={form.vestSize ?? ""} onChange={(e) => setForm({ ...form, vestSize: e.target.value })} /></Field>
              <Field label="Hat"><Input value={form.hatSize ?? ""} onChange={(e) => setForm({ ...form, hatSize: e.target.value })} /></Field>
              <Field label="Glove"><Input value={form.gloveSize ?? ""} onChange={(e) => setForm({ ...form, gloveSize: e.target.value })} /></Field>
              <Field className="sm:col-span-2" label="Notes"><Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
            <Button onClick={save} disabled={saving} data-testid="button-save-officer">{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk import */}
      <BulkImport
        open={importOpen}
        onOpenChange={setImportOpen}
        title="Bulk Import Personnel"
        endpoint="/api/officers/bulk"
        templateFilename="personnel-import-template.csv"
        actor={user?.name}
        instructions={`Required: Badge, First, Last. Rank must be one of the standard ranks. List one or more Units separated by a semicolon (;) inside the Unit cell, e.g. "Team 1 Days; Traffic". Status is active or inactive.`}
        invalidateKeys={["/api/officers"]}
        columns={OFFICER_COLUMNS}
        mapRow={(r) => ({
          badgeNumber: (r["Badge"] ?? "").trim(),
          firstName: (r["First"] ?? "").trim(),
          lastName: (r["Last"] ?? "").trim(),
          rank: (r["Rank"] ?? "").trim(),
          unit: joinUnits(parseUnits(r["Unit"] ?? "")),
          email: (r["Email"] ?? "").trim(),
          phone: (r["Phone"] ?? "").trim(),
          status: ((r["Status"] ?? "active").trim().toLowerCase() === "inactive") ? "inactive" : "active",
          hireDate: (r["Hire Date"] ?? "").trim(),
          shirtSize: (r["Shirt"] ?? "").trim(),
          pantsSize: (r["Pants"] ?? "").trim(),
          jacketSize: (r["Jacket"] ?? "").trim(),
          shoeSize: (r["Shoe"] ?? "").trim(),
          vestSize: (r["Vest"] ?? "").trim(),
          hatSize: (r["Hat"] ?? "").trim(),
          gloveSize: (r["Glove"] ?? "").trim(),
          notes: (r["Notes"] ?? "").trim(),
        })}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this officer?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes {deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName}` : ""} and their entire assignment history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={deleting}
              data-testid="button-confirm-delete-officer">
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const OFFICER_COLUMNS: ColumnSpec[] = [
  { header: "Badge", example: "2001" },
  { header: "First", example: "Jordan" },
  { header: "Last", example: "Reyes" },
  { header: "Rank", example: "Officer" },
  { header: "Unit", example: `Team 1 Days${UNIT_CSV_SEPARATOR} Traffic`, note: "Separate multiple units with a semicolon" },
  { header: "Email", example: "j.reyes@ufpd.ufl.edu" },
  { header: "Phone", example: "352-555-0199" },
  { header: "Status", example: "active" },
  { header: "Hire Date", example: "2024-01-15" },
  { header: "Shirt", example: "L" },
  { header: "Pants", example: "34x32" },
  { header: "Jacket", example: "L" },
  { header: "Shoe", example: "11" },
  { header: "Vest", example: "Medium" },
  { header: "Hat", example: "7 1/4" },
  { header: "Glove", example: "L" },
  { header: "Notes", example: "" },
];

function Field({ label, children, className, required, error }: { label: string; children: React.ReactNode; className?: string; required?: boolean; error?: string }) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs">{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
      {error && <p className="mt-1 text-xs text-destructive" data-testid="text-field-error">{error}</p>}
    </div>
  );
}

// Per-assignment serial picker shown in the officer detail sheet. Lets an
// admin/quartermaster set or replace the serialized unit tied to an active
// assignment after it was issued (PATCH /api/assignments/:id/unit).
function AssignmentUnitControl({ assignment, item, editable, actor }: { assignment: Assignment; item: Item; editable: boolean; actor?: string }) {
  const { toast } = useToast();
  const { data: units } = useQuery<ItemUnit[]>({ queryKey: ["/api/items", item.id, "units"] });
  const [saving, setSaving] = useState(false);
  const label = (u: ItemUnit) => (u.secondarySerialNumber ? `${u.serialNumber} / ${u.secondarySerialNumber}` : u.serialNumber);
  const current = (units ?? []).find((u) => u.id === assignment.itemUnitId);
  // Units this assignment can switch to: in-stock ones plus the currently held unit.
  const selectable = (units ?? []).filter((u) => u.status === "in_stock" || u.id === assignment.itemUnitId);

  async function change(unitId: string) {
    if (Number(unitId) === assignment.itemUnitId) return;
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/assignments/${assignment.id}/unit`, { itemUnitId: Number(unitId), actor });
      ["/api/assignments", "/api/items"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      queryClient.invalidateQueries({ queryKey: ["/api/items", item.id, "units"] });
      toast({ title: "Serial updated" });
    } catch (e: any) {
      toast({ title: "Could not update serial", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setSaving(false); }
  }

  if (!editable) {
    return (
      <div className="mt-1 text-xs text-muted-foreground">
        Serial: {current ? label(current) : <span className="italic">none assigned</span>}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">{isDualSerialItem(item) ? "Panel serials" : "Serial"}</span>
      <Select value={assignment.itemUnitId ? String(assignment.itemUnitId) : ""} onValueChange={change} disabled={saving}>
        <SelectTrigger className="h-8 text-xs" data-testid={`select-assignment-unit-${assignment.id}`}>
          <SelectValue placeholder="Assign a serial…" />
        </SelectTrigger>
        <SelectContent>
          {selectable.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No units available</div>
          ) : (
            selectable.map((u) => <SelectItem key={u.id} value={String(u.id)}>{label(u)}</SelectItem>)
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

// Re-print the issue receipt for an active assignment from the officer profile
// (#2). Fetches the serialized unit for unique items so the PDF shows serial(s).
function ReprintReceiptButton({ assignment, item, officer }: { assignment: Assignment; item?: Item; officer: Officer }) {
  const dual = item ? isDualSerialItem(item) : false;
  const isUnique = item?.type === "unique";
  const { data: units } = useQuery<ItemUnit[]>({ queryKey: ["/api/items", assignment.itemId, "units"], enabled: isUnique });
  const u = (units ?? []).find((x) => x.id === assignment.itemUnitId);
  const serials = u
    ? (dual && u.secondarySerialNumber
        ? `FP ${u.serialNumber} / BP ${u.secondarySerialNumber}`
        : u.secondarySerialNumber ? `${u.serialNumber} / ${u.secondarySerialNumber}` : u.serialNumber)
    : null;

  function reprint() {
    downloadIssueReceipt({
      timestamp: fmtDateTime(assignment.issuedAt),
      issuedAt: assignment.issuedAt,
      officerName: (officer.type ?? "person") === "business" ? officer.firstName : `${officer.firstName} ${officer.lastName}`,
      badgeNumber: officer.badgeNumber,
      issuedBy: assignment.issuedBy ?? null,
      issuedLocation: assignment.issuedLocation ?? null,
      dueDate: assignment.dueDate ? fmtDate(assignment.dueDate) : null,
      signature: assignment.signature ?? null,
      lines: [{
        itemName: item?.name ?? `Item #${assignment.itemId}`,
        category: item?.category ?? null,
        sizeOrVariant: (assignment as any).variantSize ?? null,
        serials,
        quantity: assignment.quantity,
        condition: item?.condition ?? null,
      }],
    });
  }

  return (
    <Button size="icon" variant="ghost" className="h-7 w-7" title="Re-print receipt" onClick={reprint} data-testid={`button-reprint-${assignment.id}`}>
      <Download className="h-4 w-4" />
    </Button>
  );
}
