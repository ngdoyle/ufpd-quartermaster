# Quartermaster — On-Hand vs. Issued Reconciliation (Par / Low-Stock)

Reconciles "on hand" with issued/maintenance/retired units so the par-reorder
report and every low-stock indicator agree, via a single source of truth. No DB
schema or issue/return logic was touched.

## Single source of truth
`shared/schema.ts` now exports:
- `UnitCounts` type and `ItemWithStock` type (`Item & { unitCounts?; onHand; lowStock }`).
- `computeStock(item, unitCounts?) => { onHand, lowStock }` — the locked definitions:
  - **onHand**: serialized item WITH tracked units (`unitCounts.total > 0`) → `unitCounts.in_stock` only (issued, maintenance, AND retired excluded). Otherwise (non-serialized, or serialized with no tracked units) → `item.quantity`.
  - **lowStock**: `parLevel > 0 && onHand <= parLevel` (at or below par; `parLevel <= 0` never flags).

## Files changed
- `shared/schema.ts` — added `UnitCounts`, `ItemWithStock`, and `computeStock` (the shared helper).
- `server/routes.ts` —
  - `GET /api/items`: now attaches computed `onHand` and `lowStock` to **every** item (alongside `unitCounts` for serialized items). This is the canonical source consumers read.
  - `GET /api/dashboard`: low-stock list/count now derived from `computeStock` over all items (previously filtered only non-serialized items by raw `quantity`, so fully-issued serialized items were never flagged). Low-stock entries carry `onHand`.
- `client/src/pages/dashboard.tsx` — "Reorder Needed" widget shows `onHand / PAR` (was raw `quantity`); `Item` interface gained optional `onHand`.
- `client/src/pages/reports.tsx` — Reorder tab uses API `lowStock`/`onHand`. On-hand column and CSV use `onHand`; reorder quantity column is now `max(parLevel - onHand, 0)` (renamed "Suggested Order" → "Reorder Qty"). Query typed `ItemWithStock[]`.
- `client/src/pages/inventory.tsx` —
  - `InvItem` type gained `onHand`/`lowStock`.
  - `StockPill` uses `onHand`/`lowStock` for all types; serialized items now show on-hand and flag amber low-stock (previously just "Serialized", never low).
  - Added a **Low Stock** status-filter option; `matchesStatus` matches it via `i.lowStock`.

## Behavior (verified)
Spec scenarios confirmed by direct unit test of `computeStock` (all PASS):
- Serialized, 3 units all issued, par 1 → onHand 0, **lowStock true** (the reported bug).
- Serialized, 1 in_stock, par 1 → onHand 1, **lowStock true** (at par).
- Serialized, 2 in_stock, par 1 → onHand 2, lowStock false.
- Serialized with maintenance + retired units only → onHand 0, lowStock true (those excluded).
- Non-serialized qty 0, par 2 → onHand 0, lowStock true.
- Serialized with NO tracked units → falls back to `quantity`.
- `parLevel <= 0` → never low, even at 0 on hand.

Live `GET /api/items` against the dev DB confirmed `onHand`/`lowStock` present on
all items (e.g. non-serialized "Duty Boots" qty 6 / par 6 → onHand 6, lowStock true).

## Verification
- `npx tsc --noEmit` → clean.
- `npm run build` → success (dist/public + dist/index.cjs).

Not committed/pushed (main agent builds, QAs, and publishes). Note: a local dev
server I started on port 5055 for verification was stopped; if the shared dev
server on port 5000 was running it should be restarted to pick up these source
changes (tsx does not hot-reload).
