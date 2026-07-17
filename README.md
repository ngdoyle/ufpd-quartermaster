# UFPD Quartermaster — IT Handoff & Operations Guide

**Application:** UFPD Quartermaster — Asset, Inventory & Issue Management
**Owner:** Ofc. Nicholas Doyle, University of Florida Police Department (UFPD)
**Audience:** UF IT / security review team
**Purpose:** Replace the legacy Microsoft Access quartermaster system with a hardened, auditable, full-stack web application for tracking tactical gear, equipment issuance, kits, and inspections.
**Status:** Prototype published for IT vetting. Not yet hosted on UF infrastructure.

---

## 1. Quick Reference

| Item | Value |
| --- | --- |
| Live demo URL | https://ufpd-quartermaster.pplx.app |
| Visibility | Public (changeable by owner) |
| Stack | Node.js (Express) + React (Vite) + Supabase-managed PostgreSQL (via PostgREST) |
| Node version | 20.x |
| Listening port | 5000 |
| Build output | `dist/index.cjs` (server), `dist/public/` (static frontend) |
| Database | Supabase-managed PostgreSQL, accessed server-side via PostgREST/RPC (`@supabase/supabase-js`) behind an `x-app-secret` RLS gate |
| Auth model | Local bcrypt accounts (default) or SSO via GatorLink/Shibboleth headers (pluggable) |

### Demo login credentials (rotate before any real use)

| Username | Role | Permissions |
| --- | --- | --- |
| `admin` | Admin | Full read/write + user management |
| `quartermaster` | Quartermaster | Read/write inventory, issuance, kits, email |
| `auditor` | Auditor | Read-only (reports, audit, compliance) |

> Passwords are stored as bcrypt hashes (cost factor 12) and are **not** committed to this repository. Seed passwords are supplied at seed time via the `QM_ADMIN_PW` / `QM_QUARTERMASTER_PW` / `QM_AUDITOR_PW` environment variables (if unset, a random password is generated and logged once). Rotate any live account from the in-app **User Accounts** page (admin only).

---

## 2. What the Application Does

UFPD Quartermaster manages the full lifecycle of department-issued equipment:

- **Personnel** — officer records plus **businesses/vendors** (the `type` field is `person` or `business`); demo uses fake data. Form fields are validated client- and server-side, and phone numbers are normalized to `(XXX) XXX-XXXX`.
- **Items / Inventory** — equipment with categories, quantities, status, and serial numbers. Supports **serialized units** (including dual-serial items such as vests), **sized clothing variants**, consumables, and a restock **"Add Existing"** flow. Firearm serials may be entered as placeholders and swapped for real ATF-registered serials later — see §8. Inventory can be **filtered by location**.
- **Issuance & Returns** — a multi-line **issue cart** with a single signature, **kit-to-cart** loadouts, and **QR scan-to-cart** (reuses the Scan page scanner). Issue and return both produce **signed PDF receipts**, and an issuance receipt can optionally be **emailed** to the officer.
- **Kits** — grouped equipment loadouts that can be issued as a unit.
- **Reports** — full suite: **Inventory by Location**, **Issuance by time frame** (to whom / by whom), **Agency Inspection Form**, **Quarterly readiness** (Template A — Critical Incident armory checklist; Template B — Training Division operational readiness), a **custom report generator**, and **CSV exports** throughout.
- **Users** — in-app account management with role editing and a **last-admin guard** (the final active administrator cannot be demoted or disabled), plus a **role capability matrix** showing what each role can do.
- **Email** — provider-agnostic outbound email subsystem (compose, overdue-return reminders, low-stock report) shipping in **log-only mode**; every send is recorded in `email_log`. See §5.
- **Audit Log** — append-only change tracking for accountability.
- **Compliance page** — in-app data classification, CJIS scoping, and control status (UF Policy 12-011; CJIS noted as out of scope), plus a batch feature summary and UF-migration checklist.
- **Branding** — UFPD badge branding on the login screen and app shell.
- **CSV Bulk Import** — bulk-load **items** and **officers** from CSV templates.

---

## 3. Architecture

```
┌─────────────────────────────┐
│  Browser (React SPA)         │
│  - Hash-based routing         │
│  - Bearer token in memory     │
└──────────────┬──────────────┘
               │  HTTPS, Authorization: Bearer <token>
               ▼
┌─────────────────────────────┐
│  Express server (port 5000)  │
│  - /api/* routes              │
│  - apiAuthGate middleware     │
│  - RBAC role guards           │
│  - Pluggable auth provider    │
└──────────────┬──────────────┘
               │  PostgREST / RPC via @supabase/supabase-js
               │  (server-side anon key + x-app-secret header)
               ▼
┌─────────────────────────────┐
│  Supabase-managed PostgreSQL │
│  - RLS gated on x-app-secret  │
│  - plpgsql RPCs for atomic    │
│    multi-write operations     │
└─────────────────────────────┘
```

- **Frontend:** React + Vite + Tailwind + shadcn/ui. Built to static assets and served directly; no server-side rendering. Routing is hash-based (`/#/dashboard`, `/#/compliance`, etc.).
- **Backend:** Express. All data access goes through a single storage interface (`server/storage.ts`). Routes are thin and validate input with Zod schemas.
- **Database:** Supabase-managed PostgreSQL, reached only from the server via `@supabase/supabase-js` (`server/supabase.ts`). Single-table CRUD uses PostgREST; every transactional/multi-write operation (batch issue, kit issue, return + restock, serialized-unit quantity sync, kit-item replace) is delegated to a plpgsql function (`supabase/migration.sql`) via `supabase.rpc()` so it runs atomically. Postgres columns are quoted camelCase matching the TS field names, so rows round-trip with no key mapping.
- **Database access hardening:** Supabase Auth is **not** used — app auth is bcrypt/bearer-token. Because the PostgREST anon key alone would grant table access, `supabase/hardening.sql` enables Row-Level Security on the public tables and gates every policy on a shared secret the server sends as an `x-app-secret` header (`APP_DB_SECRET`). A `SECURITY DEFINER` helper compares the header against a value in a private schema the anon role cannot read.
- **Authentication:** Pluggable provider in `server/auth.ts`.
  - `AUTH_MODE=local` (default): bcrypt username/password.
  - `AUTH_MODE=sso`: trusts an authenticated SSO request header (GatorLink/Shibboleth) — the header name is configurable via `SSO_HEADER_UID` (default `REMOTE_USER`). Intended for deployment behind an Apache/Shibboleth SSO proxy.

---

## 4. Security Model

The application was hardened and passed an independent security review (0 blocking issues). Key controls:

### Implemented
- **Fail-fast on database configuration:** the app refuses to start unless `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set (`server/supabase.ts`), with an actionable error rather than an opaque runtime failure on first query.
- **Encryption at rest:** the database is Supabase-managed PostgreSQL; data is encrypted at rest at the platform layer (AES-256). No database file lives in the application filesystem.
- **RLS `x-app-secret` gate:** Row-Level Security is enabled on the public tables (`supabase/hardening.sql`); PostgREST/RPC access is allowed only when the request carries the shared secret the server holds in `APP_DB_SECRET`. Privileged maintenance RPCs (`truncate_all`, `reset_sequences`) additionally refuse unauthorized PostgREST callers.
- **Server-side API authentication gate** (`server/session.ts`): opaque 256-bit bearer tokens (64-char hex), 30-minute sliding expiry. `app.use("/api", apiAuthGate)` is registered before all routes; only `/api/login` and `/api/logout` are exempt. Every other `/api` request requires a valid token or receives `401`.
- **Role-based access control (RBAC):**
  - Writes to officers/items/issuance/returns/inspections/kits require `admin` or `quartermaster`.
  - Email endpoints (`/api/email/*`) require `admin` or `quartermaster`.
  - User-management endpoints (`/api/users/*`) require `admin`, and a **last-admin guard** prevents removing the final active administrator.
  - Reads are available to any authenticated user.
- **Password policy:** bcrypt cost 12; minimum length 12 characters on change-password.
- **IDOR protection:** change-password binds to the authenticated user's ID from the validated token, ignoring any client-supplied user ID.
- **Login brute-force protection:** the login route is rate-limited (`express-rate-limit`).
- **No secrets in the client bundle:** `SUPABASE_ANON_KEY`, `APP_DB_SECRET`, and all email provider credentials are server-side only and never `VITE_`-prefixed.

### Accepted warnings (disclose / address on UF deployment)
1. **CSP / frame headers relaxed** — intentionally loosened for the demo preview iframe. The production hosting proxy should restore Content-Security-Policy and frame-protection headers.
2. **In-memory session store** — bearer tokens live in process memory. They reset on server restart, and there is no global "revoke all sessions." Acceptable for a prototype; for production, back sessions with a persistent store (e.g., Redis) or rely on the SSO proxy.
3. **Seed password logging** — seed passwords would only be written to logs if the seed environment variables were unset. Not applicable to the current instance, which already has hardened accounts provisioned.

### Notes
- Tokens are never persisted to cookies or browser storage (the demo runs in a sandboxed iframe that blocks those APIs). In a normal UF-hosted deployment you may switch to standard secure, `HttpOnly` session cookies if preferred.
- For production, the recommended posture is to run behind UF's Apache/Shibboleth SSO proxy with `AUTH_MODE=sso`; the built-in token gate then provides defense-in-depth even without the proxy.

---

## 5. Configuration (Environment Variables)

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `SUPABASE_URL` | **Yes** | none (fails fast) | Supabase project URL. Server-side only. |
| `SUPABASE_ANON_KEY` | **Yes** | none (fails fast) | Supabase anon key used by the server for PostgREST/RPC. Server-side only; never `VITE_`-prefixed. |
| `APP_DB_SECRET` | Recommended | unset | Shared secret sent as the `x-app-secret` header to satisfy the RLS policies in `hardening.sql`. Required once RLS is applied. |
| `NODE_ENV` | Recommended | `development` | Set to `production` for deployment. |
| `AUTH_MODE` | No | `local` | `local` (bcrypt) or `sso` (trusts SSO headers). |
| `SSO_HEADER_UID` | No | `REMOTE_USER` | Request header carrying the authenticated user id when `AUTH_MODE=sso` (e.g. `REMOTE_USER`, `eppn`, `uid`, `glid`). |
| `PORT` | No | `5000` | Listening port. |
| `QM_ADMIN_PW` / `QM_QUARTERMASTER_PW` / `QM_AUDITOR_PW` | No | — | Optional seed passwords for initial accounts. |
| `EMAIL_PROVIDER` | No | `log` | Outbound email adapter: `log` (record only, never delivers), `resend`, or `smtp`. |
| `RESEND_API_KEY` | If `resend` | — | API key for the Resend HTTP API. |
| `EMAIL_FROM` | If `resend`/`smtp` | — | From address for outbound mail. |
| `SMTP_HOST` | If `smtp` | — | SMTP server host. |
| `SMTP_PORT` | No | `587` | SMTP server port. |
| `SMTP_USER` | No | — | SMTP auth username (auth omitted if unset). |
| `SMTP_PASS` | No | — | SMTP auth password. |
| `SMTP_SECURE` | No | `false` | `true` to use implicit TLS (e.g. port 465). |

> **Email subsystem:** the app ships in **log-only mode** — every message (issuance receipts, overdue-return reminders, low-stock reports, ad-hoc compose) is recorded in the `email_log` table but **not delivered** until a provider is configured. Switching to UF department SMTP after server migration is **config-only** — set `EMAIL_PROVIDER=smtp` plus the `SMTP_*` and `EMAIL_FROM` variables; no code changes are required. `resend` is available as an alternative HTTP-API provider.

> **Note:** `DB_ENCRYPTION_KEY` is no longer used by the running application. Storage moved from an encrypted local SQLite file to Supabase-managed PostgreSQL; the variable survives only in the legacy SQLite-era utility scripts (see §9).

---

## 6. Build & Run (UF self-hosting)

### Prerequisites
- Node.js 20.x and npm
- Network access to the Supabase project (`SUPABASE_URL`)

### Install, build, run
```bash
# 1. Install dependencies (includes the runtime patch step)
npm ci

# 2. Build server + frontend
npm run build
#    -> dist/index.cjs (server)
#    -> dist/public/  (static frontend)

# 3. Run in production (supply DB + secret config from your secret store)
SUPABASE_URL="<project-url>" \
SUPABASE_ANON_KEY="<anon-key>" \
APP_DB_SECRET="<shared-secret>" \
NODE_ENV=production node dist/index.cjs
# App listens on port 5000
```

### Useful commands
| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development server (frontend + backend on one port) |
| `npm run build` | Production build |
| `npm run check` (`npx tsc --noEmit`) | Type-check |
| `npm start` | Run the built server (expects Supabase env vars) |

> Note: a small runtime patch (`patches/html5-qrcode+2.3.8.patch`) is applied automatically during install via `patch-package`. It makes the QR-scanner library use in-memory storage instead of browser storage APIs. `patch-package` is a production dependency so the install completes cleanly with `npm ci --omit=dev`.

### Recommended production hardening on UF infrastructure
- Terminate TLS and serve behind a reverse proxy (Apache/Nginx).
- Restore CSP and frame-protection headers at the proxy.
- Run the Node process under a service manager (systemd) with the Supabase URL/key and `APP_DB_SECRET` injected from the host secret store.
- Apply `supabase/hardening.sql` and set `APP_DB_SECRET` so RLS is enforced.
- Place the app behind UF SSO (`AUTH_MODE=sso`) if desired.
- Set `EMAIL_PROVIDER=smtp` with department SMTP credentials to enable delivery.

---

## 7. Data Persistence & Backup

- Application data lives in **Supabase-managed PostgreSQL** (not in any file in the app filesystem). Supabase provides managed, redundant storage with encryption at rest and platform-level automated backups / point-in-time recovery per the project's plan.
- **Application-level export:** every table is reachable read-only over PostgREST (`<SUPABASE_URL>/rest/v1/<table>`), which yields camelCase JSON that maps 1:1 to the schema. A JSON snapshot of the core tables can be re-imported with `scripts/migrate_data_to_supabase.ts --dir <json-dir>` (it preserves integer IDs and advances identity sequences). This is the same bulk path used to seed the Supabase instance from the prior data set.
- **Schema / RLS as code:** `supabase/migration.sql` (tables, FKs, atomic RPCs) and `supabase/hardening.sql` (RLS + `x-app-secret` gate) are idempotent and checked into the repo, so the database structure can be recreated in a fresh project.
- **Rotate the demo credentials** before real use — from the in-app User Accounts page (admin only).

---

## 8. Data Loading

### CSV bulk import (in-app)
- Covers **items** and **officers**.
- Does **not** cover assignments/issuance, kits, or audit-log entries — those are created through normal app workflows.
- Templates and a master CSV import template were provided separately.

### Firearm serial numbers (placeholder → real swap)
The workflow supports entering placeholder serials now and swapping in real ATF-registered serials later:
- `scripts/swap-serials.ts` — maps placeholder serials to real ones. **Legacy (SQLite-era)** — see §9; needs porting to the Supabase backend before use against the current database.
- `scripts/serial-map.example.csv` — example mapping file (placeholder,real).

---

## 9. Utility Scripts (`scripts/`)

| Script | Purpose |
| --- | --- |
| `normalize-phones.ts` | One-time #19 data migration: reads `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`APP_DB_SECRET`, normalizes any officer phone with exactly 10 digits to `(XXX) XXX-XXXX`, patches only changed rows, leaves non-conforming numbers untouched, and prints a summary. (Supabase-era.) |
| `migrate_data_to_supabase.ts` | One-shot loader that copies data into Supabase from a JSON backup dir (`--dir`) or a legacy SQLCipher `data.db` (`--db`), preserving IDs and advancing sequences; `--wipe` truncates first. (Supabase-era.) |
| `serial-map.example.csv` | Example serial mapping CSV (placeholder,real). |
| `swap-serials.ts` | Swap placeholder serials for real ones (dry-run default, `--apply`, auto-backup). **Legacy SQLite-era** — targets an encrypted `data.db`; needs porting to Supabase. |
| `set-password.ts` | Rotate account passwords directly in the database. **Legacy SQLite-era** — targets an encrypted `data.db`; prefer the in-app User Accounts page against the current backend. |
| `clean-slate.ts` | Wipe operational tables (items, officers, issuance, etc.) while preserving user accounts. **Legacy SQLite-era** — targets the old `db` handle; use the `truncate_all()` RPC / a `--wipe` reload against Supabase instead. |
| `sync.sh` | Convenience helper that commits and pushes the working tree to the private GitHub repo. |

---

## 10. Project Structure

```
quartermaster/
├── client/               # React frontend
│   └── src/
│       ├── pages/        # login, dashboard, inventory, officers, issue, kits,
│       │                 #   scan, reports, audit, users, email, compliance, ...
│       └── lib/          # queryClient (API + auth token), app-context (auth state)
├── server/               # Express backend
│   ├── index.ts          # server bootstrap (loads env, serves API + static)
│   ├── routes.ts         # /api routes (auth gate + RBAC registered here)
│   ├── session.ts        # bearer token issue/validate/revoke + role guards
│   ├── storage.ts        # data access layer (Supabase/PostgREST + RPC)
│   ├── supabase.ts       # supabase-js client (server-side, x-app-secret header)
│   ├── email.ts          # provider-agnostic email adapter (log|resend|smtp)
│   ├── seed.ts           # idempotent seed of demo accounts/data
│   └── auth.ts           # pluggable auth provider (local | sso)
├── shared/
│   ├── schema.ts         # Drizzle schema + Zod types (single source of truth)
│   └── validation.ts     # shared validation + phone normalization helpers
├── supabase/
│   ├── migration.sql     # tables, FKs, and atomic plpgsql RPCs
│   └── hardening.sql     # RLS + x-app-secret gate (idempotent)
├── scripts/              # utility scripts (see §9)
├── patches/              # runtime dependency patches (patch-package)
├── package.json
└── README.md             # this file
```

### Database tables
`users`, `officers`, `items`, `item_units` (serialized units), `item_variants` (sized variants), `assignments`, `kits`, `kit_items`, `audit_log`, and `email_log` (outbound email records: recipient, subject, body, template, status, provider, error, related type/id, timestamp).

---

## 11. Known Limitations / Open Items for IT

- In-memory sessions (no cross-restart persistence, no global revoke) — see §4.
- CSP/frame headers must be restored at the production proxy — see §4.
- The published demo runs in a sandboxed environment; some browser-storage behaviors differ from a normal UF-hosted deployment (handled via in-memory token auth and the QR patch).
- **RLS scope:** `hardening.sql` currently enables its `x-app-secret` policy on the nine original public tables; the newer `email_log` table should be added to the same policy loop before relying on RLS for it.
- **No DB-level unique constraint on serial numbers** — duplicate serials are prevented in application logic, not enforced by the database.
- **Non-atomic consumable restock** — the "Add Existing" consumable restock path is not wrapped in a single transaction (serialized/variant issue paths are atomic via RPCs).
- **No CHECK constraint on `officers.type`** — the `person | business` distinction is enforced in code, not by the database.
- **Missing FK on `item_units.assignedOfficerId`** — the assigned-officer reference is not backed by a foreign key.
- **N+1 query patterns** on `/api/assignments` and `/api/kits` — related rows are fetched per parent rather than joined; fine at current data volume, worth batching if data grows.
- **Generic error handler echoes exception messages** — API errors return the underlying message; acceptable for an internal tool but should be sanitized for a hostile-network deployment.
- **Email throttling** — sends are covered by route rate-limiting but there is no per-user send quota.
- Legacy SQLite-era utility scripts (`swap-serials.ts`, `set-password.ts`, `clean-slate.ts`) target the retired encrypted `data.db` and need porting to Supabase before use — see §9.

---

## 12. Classification

- Data classification: **SENSITIVE** under UF Policy 12-011.
- **CJIS:** out of scope for this system as currently designed.
- Compliance controls are summarized in the in-app Compliance page (`/#/compliance`).

---

## 13. Contacts

- **Application owner:** Ofc. Nicholas Doyle, UFPD.
- For source code, the full project archive (excluding `node_modules` and build output) and the Supabase schema/hardening SQL were provided alongside this README.
