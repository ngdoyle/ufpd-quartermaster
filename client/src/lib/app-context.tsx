import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { apiRequest, setAuthToken, setUnauthorizedHandler } from "@/lib/queryClient";

export type Role = "admin" | "quartermaster" | "supervisor" | "officer" | "auditor";

// UF System Security Policy requires re-authentication after 30 minutes or
// less of inactivity. Sessions live only in memory (React state) — there is no
// token persisted to storage — so a timeout simply clears the in-memory user.
export const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
  officerId: number | null;
  mustChangePassword: boolean;
  active: boolean;
}

interface AppCtx {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  /** True when the last session ended because of the inactivity timeout. */
  sessionExpired: boolean;
  theme: "light" | "dark";
  toggleTheme: () => void;
}

const Ctx = createContext<AppCtx>({} as AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wrap setUser so that signing in always clears any prior expiry notice, and
  // signing out tears down the server-side session and the in-memory token.
  const setUser = useCallback((u: AuthUser | null) => {
    if (u) {
      setSessionExpired(false);
    } else {
      // Explicit sign-out: revoke the token server-side (fire-and-forget, while
      // it is still attached), then clear it locally.
      apiRequest("POST", "/api/logout").catch(() => {});
      setAuthToken(null);
    }
    setUserState(u);
  }, []);

  // When the server rejects a request as unauthenticated (expired/revoked
  // session token), drop the in-memory user and surface the timeout notice.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setUserState(null);
      setSessionExpired(true);
    });
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }, [theme]);

  // Inactivity auto-logout. Only active while a user is signed in. Any of the
  // listed user-activity events resets the countdown; after the limit elapses
  // the in-memory session is cleared and the user is returned to the login
  // screen with an explanatory banner.
  useEffect(() => {
    if (!user) return;
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"];
    const reset = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        apiRequest("POST", "/api/logout").catch(() => {});
        setAuthToken(null);
        setUserState(null);
        setSessionExpired(true);
      }, INACTIVITY_LIMIT_MS);
    };
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [user]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return <Ctx.Provider value={{ user, setUser, sessionExpired, theme, toggleTheme }}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);

/** Capability checks per role */
export const can = {
  manageInventory: (r?: Role) => r === "admin" || r === "quartermaster",
  manageOfficers: (r?: Role) => r === "admin" || r === "quartermaster",
  issueReturn: (r?: Role) => r === "admin" || r === "quartermaster",
  manageUsers: (r?: Role) => r === "admin",
  viewReports: (r?: Role) => r === "admin" || r === "quartermaster" || r === "supervisor" || r === "auditor",
  viewAudit: (r?: Role) => r === "admin" || r === "quartermaster" || r === "auditor" || r === "supervisor",
  viewCompliance: (r?: Role) => r === "admin" || r === "auditor" || r === "supervisor",
  email: (r?: Role) => r === "admin" || r === "quartermaster",
};

export const roleLabel: Record<Role, string> = {
  admin: "Administrator",
  quartermaster: "Quartermaster",
  supervisor: "Supervisor",
  officer: "Officer",
  auditor: "Auditor",
};
