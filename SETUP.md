# Quartermaster — UFPD Inventory System

Full-stack web application for tracking department-owned equipment, issuance to
officers, inspections, and reporting. Built for the University of Florida Police
Department as a web replacement for a legacy Microsoft Access system.

## Tech stack

- **Frontend:** React + Vite + Tailwind CSS v3 + shadcn/ui
- **Backend:** Node.js + Express
- **Database:** SQLite via Drizzle ORM (`better-sqlite3-multiple-ciphers`,
  SQLCipher/AES-256). The database file is `data.db` in the project root and is
  **encrypted at rest** with a key supplied at runtime (see below).
- **Language:** TypeScript throughout

## What's in this package

| Path                | Contents                                                        |
| ------------------- | --------------------------------------------------------------- |
| `client/`           | React frontend (pages, components, `lib/item-fields.ts` config) |
| `server/`           | Express API, routes, and `seed.ts` database seeder              |
| `shared/`           | `schema.ts` — Drizzle schema shared by client + server          |
| `script/`, `patches/` | Build helpers and dependency patches                          |
| `data.db`           | Seeded SQLite database (sample data + demo logins)              |
| `package.json`      | Dependencies and npm scripts                                    |
| config files        | `vite.config.ts`, `tailwind.config.ts`, `drizzle.config.ts`, etc. |

> `node_modules/` and the production `dist/` build are **not** included — both are
> regenerated locally (see below).

## Running it locally

```bash
# 1. Install dependencies (recreates node_modules)
npm install

# 2. (Optional) apply the schema to a fresh database
npm run db:push

# 3. (Optional) reseed sample data into a fresh ENCRYPTED database
#    Set a strong key first; the same key must be used to run the server.
export DB_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npx tsx server/seed.ts

# 4a. Development server (hot reload)
DB_ENCRYPTION_KEY="$DB_ENCRYPTION_KEY" npm run dev

# 4b. — or — production build + run
npm run build
DB_ENCRYPTION_KEY="$DB_ENCRYPTION_KEY" NODE_ENV=production node dist/index.cjs   # serves on port 5000
```

> The schema self-initializes on first run (idempotent `CREATE TABLE IF NOT
> EXISTS`), so `npm run db:push` (drizzle-kit) is **not** used against the
> encrypted database — drizzle-kit cannot open a SQLCipher file.

## Environment variables

| Variable             | Default   | Purpose                                                                 |
| -------------------- | --------- | ----------------------------------------------------------------------- |
| `DB_ENCRYPTION_KEY`  | (dev key) | SQLCipher key for encryption at rest. **Must be set** for real data. Provide via the host's protected env/secret store. |
| `AUTH_MODE`          | `local`   | Authentication strategy: `local` (bcrypt username/password) or `sso` (trust upstream GatorLink/Shibboleth identity). |
| `SSO_HEADER_UID`     | `REMOTE_USER` | When `AUTH_MODE=sso`, the request header the Shibboleth SP injects with the authenticated identity (e.g. `eppn`, `uid`, `glid`). |
| `PORT`               | `5000`    | Listen port.                                                            |

## Demo logins (seeded)

| Role          | Username      | Password   |
| ------------- | ------------- | ---------- |
| Administrator | `admin`       | `admin123` |
| Quartermaster | `quartermaster` | `qm123`  |
| Auditor       | `auditor`     | `audit123` |

## Security note (read before any real data)

This build has been hardened from the original baseline:

- **Password hashing:** Credentials are stored as **bcrypt** hashes (cost factor 12),
  not plaintext. Any legacy plaintext password is transparently re-hashed on the
  next successful login.
- **Inactivity timeout:** Sessions are cleared after **30 minutes** of inactivity and
  the user must re-authenticate (a notice is shown on the sign-in screen).
- **Audit logging:** Sign-ins, password changes, and create/update/delete actions are
  recorded (who, what, when) and viewable in-app.
- **Security headers:** Responses set `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, and HSTS (via `helmet`).
- **Encryption at rest:** The SQLite database is encrypted on disk with
  **SQLCipher (AES-256)**. The key is supplied at runtime via `DB_ENCRYPTION_KEY`
  and never stored in source or in the file itself. Without the key the file is
  unreadable and will not open.
- **Brute-force protection:** The `/api/login` and `/api/change-password`
  endpoints are **rate-limited** (max 10 failed attempts per 15-minute window,
  keyed on client IP + attempted username; successful logins are not counted).
  Excess attempts receive HTTP 429 with a clean message.
- **SSO-ready authentication:** Auth is refactored into a pluggable provider
  (`server/auth.ts`). `AUTH_MODE=local` (default) uses the bcrypt credential
  store; `AUTH_MODE=sso` trusts the GatorLink identity asserted by an upstream
  Shibboleth SP (Apache `mod_shib` on RC PubApps) and maps it to a local account
  for role/authorization. An in-process `passport-saml` alternative is documented
  in `server/auth.ts` for environments without a reverse-proxy SP.

**Going live with SSO** additionally requires (deployment-time, not code): a UFIT
IRM **RA number**, **SP registration** in the UF SP Registry, and **IdP metadata**
exchange with the UF Identity Provider. **Encryption at rest is satisfied at the
app layer**; the hosting environment should also provide TLS 1.2+ and an
InCommon/Sectigo certificate. See the "UFIT ISO Review Readiness Packet (v1.2)"
and the "Security Screening Prep Pack" for the full requirements mapping,
evidence, and remediation roadmap.
