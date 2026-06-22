import { useState } from "react";
import { useLocation } from "wouter";
import { useApp } from "@/lib/app-context";
import { apiRequest, errorMessage } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Logo } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { user, setUser } = useApp();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) return setError("New passwords do not match.");
    if (newPassword.length < 12) return setError("Password must be at least 12 characters.");
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/change-password", { userId: user!.id, currentPassword, newPassword });
      const updated = await res.json();
      setUser({ ...user!, mustChangePassword: false });
      toast({ title: "Password updated" });
      navigate("/");
    } catch (err: any) {
      setError(errorMessage(err, "Could not update password."));
    } finally {
      setLoading(false);
    }
  }

  const body = (
    <Card className="p-6 w-full max-w-sm">
      {forced && (
        <p className="mb-4 rounded-md bg-chart-3/15 p-3 text-sm text-foreground">
          For security, please set a new password before continuing.
        </p>
      )}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="cur">Current password</Label>
          <Input id="cur" type="password" data-testid="input-current" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new">New password</Label>
          <Input id="new" type="password" data-testid="input-new" value={newPassword} onChange={(e) => setNew(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="conf">Confirm new password</Label>
          <Input id="conf" type="password" data-testid="input-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={loading} data-testid="button-save-password">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Update password
          </Button>
          {!forced && <Button type="button" variant="outline" onClick={() => navigate("/")}>Cancel</Button>}
        </div>
      </form>
    </Card>
  );

  if (forced) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-sidebar p-4">
        <div className="mb-6 flex flex-col items-center">
          <Logo className="h-12 w-12 text-sidebar-primary" />
          <h1 className="mt-3 text-lg font-bold text-white">Set a new password</h1>
        </div>
        {body}
      </div>
    );
  }
  return <div className="flex justify-center">{body}</div>;
}
