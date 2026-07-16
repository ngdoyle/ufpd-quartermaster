import { useState } from "react";
import { useApp } from "@/lib/app-context";
import { apiRequest, errorMessage, setAuthToken } from "@/lib/queryClient";
import badgeUrl from "@/assets/badge.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function Login() {
  const { setUser, sessionExpired } = useApp();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/login", { username, password });
      const { token, ...user } = await res.json();
      // Store the session token before setting the user so the very next API
      // request (e.g. dashboard load) is already authenticated.
      setAuthToken(token ?? null);
      setUser(user);
    } catch (err: any) {
      setError(errorMessage(err, "Login failed."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src={badgeUrl} alt="UFPD Quartermaster badge" className="h-28 w-auto" />
          <h1 className="mt-4 text-xl font-bold tracking-tight text-white">UFPD Quartermaster</h1>
          <p className="mt-1 text-sm text-sidebar-foreground/55">Asset, Inventory & Issue Management</p>
        </div>
        <Card className="p-6">
          {sessionExpired && (
            <p className="mb-4 rounded-md bg-chart-3/15 p-3 text-sm text-foreground" data-testid="text-session-expired">
              Your session timed out after 30 minutes of inactivity. Please sign in again.
            </p>
          )}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" data-testid="input-username" value={username}
                onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" data-testid="input-password" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </div>
            {error && <p className="text-sm text-destructive" data-testid="text-error">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-login">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Sign in
            </Button>
          </form>
          <div className="mt-5 rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <p>Authorized UFPD personnel only. Contact your Quartermaster administrator for access.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
