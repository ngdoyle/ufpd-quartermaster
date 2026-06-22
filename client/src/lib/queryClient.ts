import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

/* --------------------------- Session token ---------------------------
 * The API is protected by a server-side session token (see server/session.ts).
 * After sign-in the auth context stores the token here; every request then
 * carries it as an `Authorization: Bearer` header. The token lives only in
 * memory — it is never written to localStorage/sessionStorage/cookies (those
 * are blocked in the sandboxed iframe and would weaken security anyway).
 * ------------------------------------------------------------------- */
let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Register a callback invoked when the server rejects a request as 401. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  return authToken ? { ...base, Authorization: `Bearer ${authToken}` } : base;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

/**
 * Extract a clean, human-readable message from an error thrown by apiRequest.
 * Strips the leading status code and unwraps the JSON `{ message }` envelope
 * the API returns, falling back to the raw text or a generic message.
 */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  const raw = (err as Error)?.message ?? "";
  const stripped = raw.replace(/^\d+:\s*/, "").trim();
  if (!stripped) return fallback;
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    /* not JSON — use the stripped text as-is */
  }
  return stripped || fallback;
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: authHeaders(data ? { "Content-Type": "application/json" } : {}),
    body: data ? JSON.stringify(data) : undefined,
  });

  // A 401 on anything other than the login attempt itself means the session
  // expired or was revoked — hand off to the registered handler to sign out.
  if (res.status === 401 && url !== "/api/login") onUnauthorized?.();

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      headers: authHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }
    if (res.status === 401) onUnauthorized?.();

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
