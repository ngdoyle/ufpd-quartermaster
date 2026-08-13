import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useApp, roleLabel, Role, can } from "@/lib/app-context";
import { PageHeader, Pill, EmptyState } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, ShieldCheck, Trash2, Pencil, Check, Minus, KeyRound } from "lucide-react";

const ROLES: Role[] = ["admin", "quartermaster", "auditor"];
const roleTone: Record<string, any> = { admin: "red", quartermaster: "blue", auditor: "amber" };

// Capability matrix — derived directly from the `can` guard functions (the same
// source the server route guards mirror), so it can never drift from the truth.
const CAP_ROLES: Role[] = ["admin", "quartermaster", "auditor"];
const CAPABILITIES: { label: string; check: (r: Role) => boolean }[] = [
  { label: "Manage users", check: (r) => can.manageUsers(r) },
  { label: "Issue / return", check: (r) => can.issueReturn(r) },
  { label: "Edit inventory", check: (r) => can.manageInventory(r) },
  { label: "Edit personnel", check: (r) => can.manageOfficers(r) },
  { label: "Reports", check: (r) => can.viewReports(r) },
  { label: "Activity log", check: (r) => can.viewAudit(r) },
  { label: "Compliance", check: (r) => can.viewCompliance(r) },
  { label: "Email", check: (r) => can.email(r) },
];

export default function Users() {
  const { user } = useApp();
  const { toast } = useToast();
  const { data: users, isLoading } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: "", name: "", role: "auditor" as Role, password: "", email: "", mustChangePassword: true });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ username: "", name: "", role: "auditor" as Role, email: "" });
  const [resettingId, setResettingId] = useState<number | null>(null);

  const isAdmin = can.manageUsers(user?.role);

  function openEdit(u: any) {
    setEditForm({ username: u.username, name: u.name, role: ROLES.includes(u.role as Role) ? u.role as Role : "auditor", email: u.email ?? "" });
    setEditing(u);
  }

  async function saveEdit() {
    if (!editing) return;
    if (!editForm.username || !editForm.name) return toast({ title: "Name and username required", variant: "destructive" });
    setSaving(true);
    try {
      const patch: any = { username: editForm.username, name: editForm.name, role: editForm.role, email: editForm.email.trim() || null, actor: user?.name };
      await apiRequest("PATCH", `/api/users/${editing.id}`, patch);
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Account updated" });
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function save() {
    if (!form.username || !form.name || !form.password) return toast({ title: "All fields required", variant: "destructive" });
    setSaving(true);
    try {
      await apiRequest("POST", "/api/users", { ...form, email: form.email.trim() || null, active: true, officerId: null, actor: user?.name });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Account created" });
      setCreating(false); setForm({ username: "", name: "", role: "auditor", password: "", email: "", mustChangePassword: true });
    } catch (e: any) {
      toast({ title: "Failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setSaving(false); }
  }

  async function resetPassword(u: any) {
    setResettingId(u.id);
    try {
      await apiRequest("POST", `/api/users/${u.id}/reset-password`, { actor: user?.name });
      toast({ title: "Temporary password emailed." });
    } catch (e: any) {
      toast({ title: "Reset failed", description: e.message?.replace(/^\d+:\s*/, ""), variant: "destructive" });
    } finally { setResettingId(null); }
  }

  async function toggleActive(u: any) {
    await apiRequest("PATCH", `/api/users/${u.id}`, { active: !u.active, actor: user?.name });
    queryClient.invalidateQueries({ queryKey: ["/api/users"] });
  }

  async function remove(id: number) {
    await apiRequest("DELETE", `/api/users/${id}?actor=${encodeURIComponent(user?.name ?? "")}`);
    queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    toast({ title: "Account deleted" });
  }

  return (
    <div>
      <PageHeader title="User Accounts" subtitle="Manage who can sign in and what they can do"
        actions={<Button size="sm" onClick={() => setCreating(true)} data-testid="button-add-user"><Plus className="mr-1.5 h-4 w-4" /> Add Account</Button>} />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : !users?.length ? <EmptyState title="No accounts" /> : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`row-user-${u.id}`}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/12 text-primary"><ShieldCheck className="h-5 w-5" /></span>
                  <div>
                    <p className="font-medium leading-tight">{u.name} {u.id === user?.id && <span className="text-xs text-muted-foreground">(you)</span>}</p>
                    <p className="text-xs text-muted-foreground">{u.username}{u.email ? ` · ${u.email}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Pill tone={roleTone[u.role] ?? "gray"}>{roleLabel[u.role as Role] ?? "No access"}</Pill>
                  <Pill tone={u.active ? "green" : "gray"}>{u.active ? "Active" : "Disabled"}</Pill>
                  <Button variant="outline" size="sm" onClick={() => openEdit(u)} data-testid={`button-edit-user-${u.id}`}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit</Button>
                  {isAdmin && (
                    <AlertDialog>
                      <span title={u.email ? "Email a temporary password" : "No email on file — add one before resetting"} className="inline-flex">
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm" disabled={!u.email || resettingId === u.id} data-testid={`button-reset-password-${u.id}`}>
                            <KeyRound className="mr-1.5 h-3.5 w-3.5" /> {resettingId === u.id ? "Sending…" : "Reset Password"}
                          </Button>
                        </AlertDialogTrigger>
                      </span>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Reset password for {u.username}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            A temporary password will be generated and emailed to {u.email}. The user must change it at next sign-in. The temporary password is never displayed here.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => resetPassword(u)} data-testid={`button-confirm-reset-${u.id}`}>Send temporary password</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {u.id !== user?.id && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => toggleActive(u)} data-testid={`button-toggle-${u.id}`}>{u.active ? "Disable" : "Enable"}</Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon" data-testid={`button-delete-user-${u.id}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Delete {u.username}?</AlertDialogTitle><AlertDialogDescription>This permanently removes the account.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => remove(u.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Account</DialogTitle><DialogDescription>Create a sign-in account and assign a role.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Full name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-user-name" /></div>
            <div className="space-y-1.5"><Label>Username</Label><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} data-testid="input-user-username" /></div>
            <div className="space-y-1.5"><Label>Email <span className="text-muted-foreground">(optional)</span></Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="input-user-email" /></div>
            <div className="space-y-1.5"><Label>Temporary password</Label><Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="input-user-password" /></div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger data-testid="select-role"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.mustChangePassword} onCheckedChange={(v) => setForm({ ...form, mustChangePassword: !!v })} />
              Require password change at first sign-in
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving} data-testid="button-save-user">{saving ? "Saving…" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit Account</DialogTitle><DialogDescription>Change name, username, email, or role. Use “Reset Password” to email the user a new temporary password.</DialogDescription></DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5"><Label>Full name</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} data-testid="input-edit-user-name" /></div>
            <div className="space-y-1.5"><Label>Username</Label><Input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} data-testid="input-edit-user-username" /></div>
            <div className="space-y-1.5"><Label>Email <span className="text-muted-foreground">(optional)</span></Label><Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} data-testid="input-edit-user-email" /></div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={(v) => setEditForm({ ...editForm, role: v as Role })}>
                <SelectTrigger data-testid="select-edit-role"><SelectValue /></SelectTrigger>
                <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{roleLabel[r]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving} data-testid="button-save-edit-user">{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="mt-6 overflow-hidden" data-testid="card-capability-matrix">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Role capabilities</h2>
          <p className="text-xs text-muted-foreground">What each role can do across the three application roles. Reflects the capability checks the server route guards enforce.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Capability</th>
                {CAP_ROLES.map((r) => (
                  <th key={r} className="px-3 py-2 text-center font-medium">{roleLabel[r]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((cap) => (
                <tr key={cap.label} className="border-b border-border last:border-0" data-testid={`row-cap-${cap.label.replace(/[^a-z]+/gi, "-").toLowerCase()}`}>
                  <td className="px-4 py-2">{cap.label}</td>
                  {CAP_ROLES.map((r) => (
                    <td key={r} className="px-3 py-2 text-center">
                      {cap.check(r) ? (
                        <Check className="mx-auto h-4 w-4 text-green-600 dark:text-green-500" aria-label="yes" />
                      ) : (
                        <Minus className="mx-auto h-4 w-4 text-muted-foreground/40" aria-label="no" />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
