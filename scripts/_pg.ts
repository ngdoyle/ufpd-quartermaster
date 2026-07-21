/**
 * _pg.ts — shared helpers for the admin scripts (Supabase / PostgREST port).
 *
 * The admin scripts talk to the same Postgres database the app uses, via
 * PostgREST at $SUPABASE_URL/rest/v1/<table>. Required env vars (read from the
 * file named by --env, default .env.dev):
 *
 *   SUPABASE_URL       e.g. https://<project>.supabase.co
 *   SUPABASE_ANON_KEY  the anon key the server uses (server-side only)
 *   APP_DB_SECRET      shared secret sent as x-app-secret (RLS gate)
 *
 * To run against production later, point --env at a prod env file, e.g.
 *   npx tsx scripts/<name>.ts --env /path/to/prod.env ...
 *
 * These scripts NEVER read a real .env by default and NEVER hardcode secrets.
 */
import { readFileSync } from "node:fs";

/** Parse `--flag value`, `--flag`, and positional args from argv (post-node). */
export function parseArgs(argv: string[]): {
  opts: Record<string, string>;
  flags: Set<string>;
  positionals: string[];
} {
  const opts: Record<string, string> = {};
  const flags = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        opts[key] = next;
        i++;
      } else {
        flags.add(key);
      }
    } else {
      positionals.push(a);
    }
  }
  return { opts, flags, positionals };
}

/** Read a KEY=VALUE env file (no dotenv dependency). Ignores blanks/comments. */
export function loadEnvFile(path: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    console.error(`[abort] Could not read env file: ${path}`);
    process.exit(1);
  }
  const env: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

export interface PgConfig {
  url: string;
  anonKey: string;
  appSecret?: string;
  label: string;
}

/** Build PostgREST config from a loaded env map; fail fast on missing vars. */
export function pgConfig(env: Record<string, string>, envPath: string): PgConfig {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    console.error(`[abort] ${envPath} must define SUPABASE_URL and SUPABASE_ANON_KEY.`);
    process.exit(1);
  }
  const projectRef = (url.match(/https?:\/\/([^.]+)\./)?.[1]) ?? url;
  return { url: url.replace(/\/$/, ""), anonKey, appSecret: env.APP_DB_SECRET, label: projectRef };
}

function headers(cfg: PgConfig, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${cfg.anonKey}`,
    "content-type": "application/json",
  };
  if (cfg.appSecret) h["x-app-secret"] = cfg.appSecret;
  return { ...h, ...extra };
}

async function req(cfg: PgConfig, method: string, pathAndQuery: string, body?: unknown, extraHeaders?: Record<string, string>) {
  const res = await fetch(`${cfg.url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: headers(cfg, extraHeaders),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PostgREST ${method} ${pathAndQuery} → ${res.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : [];
}

/** SELECT rows. `query` is the PostgREST query string, e.g. "select=*&id=eq.5". */
export function pgSelect<T = any>(cfg: PgConfig, table: string, query = "select=*"): Promise<T[]> {
  return req(cfg, "GET", `${table}?${query}`) as Promise<T[]>;
}

/** PATCH rows matching `filter` (a PostgREST filter, e.g. "id=eq.5"); returns updated rows. */
export function pgPatch<T = any>(cfg: PgConfig, table: string, filter: string, patch: Record<string, unknown>): Promise<T[]> {
  return req(cfg, "PATCH", `${table}?${filter}`, patch, { Prefer: "return=representation" }) as Promise<T[]>;
}

/** DELETE rows matching `filter`; returns deleted rows. */
export function pgDelete<T = any>(cfg: PgConfig, table: string, filter: string): Promise<T[]> {
  return req(cfg, "DELETE", `${table}?${filter}`, undefined, { Prefer: "return=representation" }) as Promise<T[]>;
}

/** Count rows in a table (uses PostgREST HEAD + Content-Range). */
export async function pgCount(cfg: PgConfig, table: string, filter = ""): Promise<number> {
  const q = filter ? `${table}?${filter}` : `${table}?select=id`;
  const res = await fetch(`${cfg.url}/rest/v1/${q}`, {
    method: "GET",
    headers: headers(cfg, { Prefer: "count=exact", Range: "0-0" }),
  });
  if (!res.ok) throw new Error(`count ${table} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  const cr = res.headers.get("content-range") ?? "";
  const total = cr.split("/")[1];
  return total && total !== "*" ? Number(total) : 0;
}

/** Resolve the --env path (default .env.dev) and load its PgConfig. */
export function resolvePg(opts: Record<string, string>): { cfg: PgConfig; envPath: string } {
  const envPath = opts.env ?? ".env.dev";
  const cfg = pgConfig(loadEnvFile(envPath), envPath);
  return { cfg, envPath };
}
