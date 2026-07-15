import { createClient } from "@supabase/supabase-js";
import ws from "ws";

/* ------------------------------------------------------------------ *
 * Supabase (Postgres) client — the app's only database connection.
 *
 * Access is via PostgREST / RPC using the service-side anon key. The key is
 * read from the environment (loaded by `import "dotenv/config"` in
 * server/index.ts) and is NEVER exposed to the client bundle: it is not
 * VITE_-prefixed and is only referenced here on the server. The app's own
 * bcrypt/bearer-token auth is unchanged — Supabase Auth is not used, so we
 * disable session persistence and token refresh on the client.
 * ------------------------------------------------------------------ */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fail fast with a clear, actionable message instead of surfacing an opaque
  // runtime error on the first query.
  throw new Error(
    "[supabase] SUPABASE_URL and SUPABASE_ANON_KEY must be set. Add them to " +
      "the server environment (.env) before starting. They are server-side " +
      "only and must never be VITE_-prefixed or exposed to the client.",
  );
}

// Shared secret for RLS hardening (supabase/hardening.sql). When set, it is sent
// on every PostgREST/RPC request as `x-app-secret`; the RLS policies gate all
// table access on it matching the value stored in `private.app_config`. Left
// unset for local flexibility (RLS not yet applied) — the app still works.
const APP_DB_SECRET = process.env.APP_DB_SECRET;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  // supabase-js eagerly constructs a Realtime client, which needs a WebSocket
  // constructor. Node < 22 has no global WebSocket, so supply `ws`. Realtime is
  // never used (database-only access via PostgREST/RPC), but the constructor
  // must not throw at startup.
  realtime: { transport: ws as unknown as typeof WebSocket },
  ...(APP_DB_SECRET
    ? { global: { headers: { "x-app-secret": APP_DB_SECRET } } }
    : {}),
});

// Unwrap a PostgREST single/maybe result, throwing on error so callers can rely
// on normal try/catch (routes already wrap handlers in try/catch → handleErr).
export function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}
