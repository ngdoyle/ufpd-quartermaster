# UFPD Quartermaster — IT Handoff & Operations Guide

**Application:** Quartermaster — Asset, Inventory & Issue Management
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
| Stack | Node.js (Express) + React (Vite) + SQLite (encrypted) |
| Node version | 20.x |
| Listening port | 5000 |
| Build output | `dist/index.cjs` (server), `dist/public/` (static frontend) |
| Database | `data.db` (SQLite, SQLCipher-encrypted) in project root |
| Auth model | Local bcrypt accounts (default) or SSO via Shibboleth headers (pluggable) |

### Demo login credentials (rotate before any real use)

| Username | Role | Permissions |
| --- | --- | --- |
| `admin` | Admin | Full read/write + user management |
| `quartermaster` | Quartermaster | Read/write inventory, issuance, kits |
| `auditor` | Auditor | Read-only |

> Passwords are stored as bcrypt hashes (cost factor 12) and are **not** committed to this repository. Seed passwords are supplied at seed time via the `QM_ADMIN_PW` / `QM_QM_PW` / `QM_AUDITOR_PW` environment variables (if unset, a random password is generated and logged once). Rotate any live account with `scripts/set-password.ts` (see §9).

---

## 2. What the Application Does

Quartermaster manages the full lifecycle of department-issued equipment:

- **Personnel** — officer records (demo uses fake officer data).
- **Items / Inventory** — equipment with categories, quantities, status, and serial numbers (firearm serials may be entered as placeholders and swapped for real ATF-registered serials later — see §8).
- **Issuance & Returns** — assign items to officers, track returns.
- **Kits** — grouped equipment loadouts.
- **Inspections** — record equipment inspection events.
- **Reports** — inventory and issuance reporting.
- **Audit Log** — change tracking for accountability.
- **Compliance page** — in-app classification and control summary (UF Policy 12-011; CJIS noted as out of scope).
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
               │  synchronous queries (better-sqlite3)
               ▼
┌─────────────────────────────┐
│  SQLite (SQLCipher encrypted)│
│  data.db (key = env var)      │
└─────────────────────────────┘
```

- **Frontend:** React + Vite + Tailwind + shadcn/ui. Built to static assets and served directly; no server-side rendering. Routing is hash-based (`/#/dashboard`, `/#/compliance`, etc.).
- **Backend:** Express. All data access goes through a single storage interface (`server/storage.ts`). Routes are thin and validate input with Zod schemas.
- **Database:** SQLite via `better-sqlite3-multiple-ciphers` (SQLCipher). The entire database file is encrypted at rest; the key is supplied via the `DB_ENCRYPTION_KEY` environment variable.
- **Authentication:** Pluggable provider in `server/auth.ts`.
  - `AUTH_MODE=local` (default): bcrypt username/password.
  - `AUTH_MODE=sso`: trusts authenticated Shibboleth request headers — intended for deployment behind an Apache/Shibboleth SSO proxy.

---

## 4. Security Model

The application was hardened and passed an independent security review (0 blocking issues). Key controls:

### Implemented
- **Encrypted database at rest** (SQLCipher). The app **refuses to start in production** if `DB_ENCRYPTION_KEY` is not set — it will not silently fall back to an insecure development key (fail-fast in `server/storage.ts`).
- **Server-side API authentication gate** (`server/session.ts`): opaque 256-bit bearer tokens (64-char hex), 30-minute sliding expiry. `app.use("/api", apiAuthGate)` is registered before all routes; only `/api/login` and `/api/logout` are exempt. Every other `/api` request requires a valid token or receives `401`.
- **Role-based access control (RBAC):**
  - Writes to officers/items/issuance/returns/inspections/kits require `admin` or `quartermaster`.
  - User-management endpoints (`/api/users/*`) require `admin`.
  - Reads are available to any authenticated user.
- **Password policy:** bcrypt cost 12; minimum length 12 characters on change-password.
- **IDOR protection:** change-password binds to the authenticated user's ID from the validated token, ignoring any client-supplied user ID.

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
| `DB_ENCRYPTION_KEY` | **Yes (production)** | none (fails fast) | SQLCipher key for `data.db`. Supply from a secret store — never hardcode. |
| `NODE_ENV` | Recommended | `development` | Set to `production` for deployment. |
| `AUTH_MODE` | No | `local` | `local` (bcrypt) or `sso` (Shibboleth header trust). |
| `PORT` | No | `5000` | Listening port. |
| `QM_ADMIN_PW` / `QM_QM_PW` / `QM_AUDITOR_PW` | No | — | Optional seed passwords for initial accounts. |

> **Important:** The encryption key must travel with the database. If you move `data.db`, you must also provide the same `DB_ENCRYPTION_KEY`, or the data cannot be read.

---

## 6. Build & Run (UF self-hosting)

### Prerequisites
- Node.js 20.x and npm
- A build toolchain capable of compiling `better-sqlite3-multiple-ciphers` native bindings (build-essential / Python 3 on Linux)

### Install, build, run
```bash
# 1. Install dependencies (includes the runtime patch step)
npm ci

# 2. Build server + frontend
npm run build
#    -> dist/index.cjs (server)
#    -> dist/public/  (static frontend)

# 3. Run in production (supply the encryption key from your secret store)
DB_ENCRYPTION_KEY="<your-key>" NODE_ENV=production node dist/index.cjs
# App listens on port 5000
```

### Useful commands
| Command | Purpose |
| --- | --- |
| `npm run dev` | Local development server (frontend + backend on one port) |
| `npm run build` | Production build |
| `npx tsc --noEmit` | Type-check |
| `npm start` | Run the built server (expects `DB_ENCRYPTION_KEY`) |

> Note: a small runtime patch (`patches/html5-qrcode+2.3.8.patch`) is applied automatically during install via `patch-package`. It makes the QR-scanner library use in-memory storage instead of browser storage APIs. `patch-package` is a production dependency so the install completes cleanly with `npm ci --omit=dev`.

### Recommended production hardening on UF infrastructure
- Terminate TLS and serve behind a reverse proxy (Apache/Nginx).
- Restore CSP and frame-protection headers at the proxy.
- Run the Node process under a service manager (systemd) with the encryption key injected from the host secret store.
- Place the app behind UF SSO (`AUTH_MODE=sso`) if desired.
- Schedule regular encrypted backups of `data.db`.

---

## 7. Data Persistence & Backup

- All application data lives in a **single file: `data.db`** (encrypted). Backing up the app data is as simple as copying this file — but the matching `DB_ENCRYPTION_KEY` is required to open it.
- For production-grade durability, host `data.db` on managed/redundant storage and run scheduled backups, or migrate to a managed database (e.g., PostgreSQL/Supabase). The current SQLite design is appropriate for single-server departmental use.
- **Rotate the demo credentials** before real use. Use the included `scripts/set-password.ts` utility to rotate live-database account passwords (see §9).

---

## 8. Data Loading

### CSV bulk import (in-app)
- Covers **items** and **officers**.
- Does **not** cover assignments/issuance, kits, or audit-log entries — those are created through normal app workflows.
- Templates and a master CSV import template were provided separately.

### Firearm serial numbers (placeholder → real swap)
The workflow supports entering placeholder serials now and swapping in real ATF-registered serials later:
- `scripts/swap-serials.ts` — maps placeholder serials to real ones. Dry-run by default; pass `--apply` to commit. Creates an automatic backup before applying.
- `scripts/serial-map.example.csv` — example mapping file (placeholder,real).

---

## 9. Utility Scripts (`scripts/`)

| Script | Purpose |
| --- | --- |
| `swap-serials.ts` | Swap placeholder serials for real ones (dry-run default, `--apply`, auto-backup). |
| `serial-map.example.csv` | Example serial mapping CSV. |
| `set-password.ts` | Rotate an account password directly in the live database. |
| `clean-slate.ts` | Wipe operational tables (items, officers, issuance, etc.) while preserving user accounts. Used to reset to a clean state before loading real data. |

---

## 10. Project Structure

```
quartermaster/
├── client/               # React frontend
│   └── src/
│       ├── pages/        # login, dashboard, compliance, change-password, ...
│       └── lib/          # queryClient (API + auth token), app-context (auth state)
├── server/               # Express backend
│   ├── index.ts          # server bootstrap
│   ├── routes.ts         # /api routes (auth gate + RBAC registered here)
│   ├── session.ts        # bearer token issue/validate/revoke + role guards
│   ├── storage.ts        # data access layer + DB encryption / fail-fast
│   └── auth.ts           # pluggable auth provider (local | sso)
├── shared/
│   └── schema.ts         # Drizzle schema + Zod types (single source of truth)
├── scripts/              # utility scripts (see §9)
├── patches/              # runtime dependency patches (patch-package)
├── data.db               # encrypted SQLite database (do not commit real data)
├── package.json
└── README.md             # this file
```

---

## 11. Known Limitations / Open Items for IT

- In-memory sessions (no cross-restart persistence, no global revoke) — see §4.
- CSP/frame headers must be restored at the production proxy — see §4.
- SQLite single-file database — suitable for single-server use; consider a managed DB for multi-server HA.
- The published demo runs in a sandboxed environment; some browser-storage behaviors differ from a normal UF-hosted deployment (handled via in-memory token auth and the QR patch).

---

## 12. Classification

- Data classification: **SENSITIVE** under UF Policy 12-011.
- **CJIS:** out of scope for this system as currently designed.
- Compliance controls are summarized in the in-app Compliance page (`/#/compliance`).

---

## 13. Contacts

- **Application owner:** Ofc. Nicholas Doyle, UFPD.
- For source code, the full project archive (excluding `node_modules`, build output, and database) and a clean-slate `data.db` backup were provided alongside this README.
