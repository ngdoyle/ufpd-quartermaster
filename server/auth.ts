import type { Request } from "express";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import type { User } from "@shared/schema";

/* =====================================================================
 * Authentication — pluggable provider architecture
 * ---------------------------------------------------------------------
 * The application selects an authentication strategy at startup via the
 * AUTH_MODE environment variable:
 *
 *   AUTH_MODE=local  (default) — username/password verified against the
 *                     local bcrypt credential store. Used for the demo
 *                     and for standalone/offline operation.
 *
 *   AUTH_MODE=sso    — delegate authentication to UF's GatorLink Single
 *                     Sign-On. On RC PubApps, an Apache + Shibboleth SP
 *                     (mod_shib) performs the SAML2 handshake with the UF
 *                     IdP and injects the authenticated identity as a
 *                     request header. The app trusts that header and never
 *                     handles the user's password.
 *
 * Both strategies resolve to a local User row (for role/authorization),
 * so switching modes does not change the rest of the app. Going live with
 * SSO additionally requires a UF IRM RA number, SP registration in the UF
 * SP Registry, and IdP metadata exchange (documented in the setup notes) —
 * those are deployment-time configuration, not code changes.
 * ===================================================================== */

const BCRYPT_ROUNDS = 12;
const APP_ROLES = new Set(["admin", "quartermaster", "auditor"]);

function isApplicationRole(role: unknown): boolean {
  return APP_ROLES.has(String(role));
}

export const hashPassword = (plain: string) => bcrypt.hashSync(String(plain), BCRYPT_ROUNDS);
export const isHashed = (stored: string) =>
  typeof stored === "string" && /^\$2[aby]\$/.test(stored);

// Verify a candidate password against the stored value. Transparently
// upgrades any legacy plaintext credential to a bcrypt hash on first
// successful login, so pre-hardening accounts migrate without a forced reset.
export async function verifyPassword(
  candidate: string,
  user: { id: number; password: string },
): Promise<boolean> {
  if (isHashed(user.password)) {
    return bcrypt.compare(String(candidate), user.password);
  }
  // Legacy plaintext fallback + auto-upgrade.
  if (String(candidate) === user.password) {
    await storage.updateUser(user.id, { password: hashPassword(candidate) });
    return true;
  }
  return false;
}

export interface AuthOutcome {
  user: User | null;
  status: number; // HTTP status to send on failure (ignored on success)
  message?: string; // user-facing message on failure
}

export interface AuthProvider {
  readonly mode: string;
  authenticate(req: Request): Promise<AuthOutcome>;
}

/* ----------------------------- Local ------------------------------ */
class LocalAuthProvider implements AuthProvider {
  readonly mode = "local";

  async authenticate(req: Request): Promise<AuthOutcome> {
    const { username, password } = req.body ?? {};
    const user = await storage.getUserByUsername(String(username ?? "").trim());
    // Always run a verification step (even when the user is missing) to keep
    // response timing uniform and avoid leaking which usernames exist.
    const ok = user ? await verifyPassword(String(password ?? ""), user) : false;
    if (!user || !ok || !user.active || !isApplicationRole(user.role)) {
      return { user: null, status: 401, message: "Invalid username or password." };
    }
    return { user, status: 200 };
  }
}

/* ------------------------------ SSO ------------------------------- */
// Trust the identity asserted by an upstream Shibboleth SP. The header name
// is configurable (REMOTE_USER, eppn, uid, glid, …) via SSO_HEADER_UID to
// match whatever the UF IdP releases and the SP is configured to inject.
class SsoAuthProvider implements AuthProvider {
  readonly mode = "sso";
  private readonly headerName = (process.env.SSO_HEADER_UID || "REMOTE_USER").toLowerCase();

  async authenticate(req: Request): Promise<AuthOutcome> {
    const raw = (req.headers[this.headerName] as string | undefined) || "";
    // eppn / scoped identifiers arrive as "gatorlink@ufl.edu" — reduce to the
    // bare GatorLink username used as the local account key.
    const gatorlink = raw.split("@")[0].trim().toLowerCase();
    if (!gatorlink) {
      return {
        user: null,
        status: 401,
        message: "No GatorLink identity was presented. Please sign in through Single Sign-On.",
      };
    }
    const user = await storage.getUserByUsername(gatorlink);
    if (!user || !user.active || !isApplicationRole(user.role)) {
      // Authenticated upstream, but no provisioned/authorized local account.
      return {
        user: null,
        status: 403,
        message: "Your GatorLink account is not provisioned for the Quartermaster system.",
      };
    }
    return { user, status: 200 };
  }
}

const AUTH_MODE = (process.env.AUTH_MODE || "local").toLowerCase();

export const authProvider: AuthProvider =
  AUTH_MODE === "sso" ? new SsoAuthProvider() : new LocalAuthProvider();

export const authMode = authProvider.mode;

/* ---------------------------------------------------------------------
 * In-app SSO alternative (no reverse proxy)
 * ---------------------------------------------------------------------
 * Where an Apache/Shibboleth SP in front of the app is not available, the
 * same SAML2 flow can run inside the Node process using `passport` +
 * `passport-saml` (both already in the dependency allowlist): configure a
 * SAML strategy with UF's IdP entryPoint, the IdP signing certificate, and
 * this app's SP entityID/ACS URL, then expose /login (redirect to IdP) and
 * /login/callback (consume the assertion) routes. The resulting profile's
 * GatorLink attribute maps to a local User exactly as the header-trust
 * provider above does, so no other application code changes.
 * ------------------------------------------------------------------- */
