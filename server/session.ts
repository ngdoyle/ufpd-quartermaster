import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import type { User } from "@shared/schema";

/* =====================================================================
 * Server-side session tokens — defense-in-depth API authentication
 * ---------------------------------------------------------------------
 * The production deployment design places this app behind an Apache +
 * Shibboleth SSO proxy that enforces authentication for every request
 * (AUTH_MODE=sso). That proxy is NOT present in standalone/preview
 * hosting, so on its own the API would be reachable without a login.
 *
 * To keep the API protected in EVERY deployment — proxied or not — each
 * successful sign-in mints an opaque bearer token. A small middleware
 * (`requireAuth`) rejects any /api request that does not carry a valid,
 * unexpired token. Tokens live only in server memory (never persisted),
 * mirror the 30-minute inactivity policy enforced in the client, and
 * slide forward on each authenticated request so an active session is
 * not interrupted.
 * ===================================================================== */

// Match the client-side inactivity limit (UF System Security Policy: <= 30m).
const SESSION_TTL_MS = 30 * 60 * 1000;

export interface Session {
  userId: number;
  username: string;
  role: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function newToken(): string {
  // 256 bits of entropy, URL-safe hex. Collision-resistant and unguessable.
  return randomBytes(32).toString("hex");
}

/** Mint a fresh session token for an authenticated user. */
export function issueToken(user: Pick<User, "id" | "username" | "role">): string {
  // Opportunistically evict expired sessions so the map cannot grow without
  // bound on a long-lived process.
  const now = Date.now();
  sessions.forEach((s, t) => { if (s.expiresAt <= now) sessions.delete(t); });

  const token = newToken();
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: String(user.role),
    expiresAt: now + SESSION_TTL_MS,
  });
  return token;
}

/** Validate a token, sliding its expiry forward. Returns the session or null. */
export function validateToken(token: string | undefined): Session | null {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt <= now) {
    sessions.delete(token);
    return null;
  }
  // Sliding expiration: an active session keeps refreshing.
  s.expiresAt = now + SESSION_TTL_MS;
  return s;
}

/** Invalidate a token (sign-out). */
export function revokeToken(token: string | undefined): void {
  if (token) sessions.delete(token);
}

/** Pull the bearer token out of the Authorization header. */
export function bearerToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : undefined;
}

// Augment Express's Request so route handlers can read the authenticated user.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: Session;
    }
  }
}

/**
 * Gate every /api route except the unauthenticated entry points (login).
 * Mounted with `app.use("/api", apiAuthGate)` so `req.path` is relative to
 * the /api mount point.
 */
export function apiAuthGate(req: Request, res: Response, next: NextFunction): void {
  // Endpoints reachable without a valid session. `/login` mints a token;
  // `/logout` simply revokes whatever token is presented (a no-op if absent or
  // already expired) and must never 401, so it stays open. Everything else is
  // protected.
  const open = req.path === "/login" || req.path === "/logout";
  if (open) return next();

  const session = validateToken(bearerToken(req));
  if (!session) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }
  req.authUser = session;
  next();
}

/**
 * Route-level authorization guard. Use after the gate to restrict a mutation
 * to specific roles, mirroring the client-side capability checks so the server
 * is the real enforcement point (a privileged action cannot be performed by a
 * lower-privilege account just by calling the API directly).
 */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.authUser?.role;
    if (!role || !roles.includes(role)) {
      res.status(403).json({ message: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}
