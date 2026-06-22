# Quartermaster — Serialized-Unit Reconstruction Notes

Reconstructs the per-unit serialized inventory system (PART A) and adds the kit
serial-selection feature (PART B), per `qm_spec.md`. All migrations are additive
only; live data is snapshotted forward on deploy.

## Files changed

### Schema / server
- `shared/schema.ts` — added `item_units` table (`itemUnits`) + `insertItemUnitSchema`/`InsertItemUnit`/`ItemUnit`; added nullable `itemUnitId` (`item_unit_id`) column to `assignments`.
- `server/storage.ts` —
  - Raw `CREATE TABLE IF NOT EXISTS "item_units" (...)` in the self-init exec block (snake_case columns matching Drizzle).
  - `addColumnIfMissing()` helper + additive `ALTER TABLE` for `assignments.item_unit_id` and `item_units.secondary_serial_number` (drizzle-kit push cannot open the encrypted DB).
  - `UnitStatusCounts` type; CRUD: `listUnitsByItem`, `getUnit`, `createUnit`, `updateUnit`, `deleteUnit`; `unitStatusCountsByItem`; `syncItemQuantity` (for `unique` items: quantity = unit count, status = in_stock if any in-stock else issued — does NOT clobber manual maintenance/retired holds).
- `server/routes.ts` — unit endpoints, `unitCounts` on GET /api/items, unit-aware issue/return, kit issue rewrite, assignment-unit PATCH (details below).

### Client
- `client/src/components/serial-units-dialog.tsx` — NEW. `isDualSerialItem(item)` (= category `"Ballistic Vests"`); `SerialUnitsDialog` (table + add/edit/delete + CSV export + bulk add). Vests use Front/Back panel serials; others single serial.
- `client/src/pages/inventory.tsx` — `StatusCell` (per-status pills from `unitCounts`), fixed "Issued" status filter for unique items (matches via `unitCounts`), "Manage Serials" entry button.
- `client/src/pages/issue.tsx` — serial/unit picker for unique items, dual-serial labels, `itemUnitId` in payload, no-units warning.
- `client/src/pages/scan.tsx` — quick-issue serial/unit picker, same labels/validation.
- `client/src/pages/kits.tsx` — kit serial selection (`KitUnitPicker` per serialized line, blocking warning when no stock), passes `unitSelections`.
- `client/src/pages/officers.tsx` — `AssignmentUnitControl` in the detail sheet's "Currently Issued" list; admin/quartermaster can set/replace the unit on an active unique assignment (PATCH /api/assignments/:id/unit). Read-only serial line for non-editors.

## Endpoint contracts

- `GET /api/items` → unique items carry `unitCounts: {total,in_stock,issued,maintenance,retired}`.
- `GET /api/items/:id/units` → `ItemUnit[]` (`{id,itemId,serialNumber,secondarySerialNumber,status,condition,assignedOfficerId,location,acquiredDate,notes,createdAt}`).
- `POST /api/items/:id/units` (writeGuard) → accepts a single unit body, `{serials:[...]}`, or `{units:[{serialNumber,secondarySerialNumber}]}`. Audit `add_unit`.
- `PATCH /api/units/:unitId` (writeGuard) → partial unit update; triggers quantity/status sync. Audit `update_unit`.
- `DELETE /api/units/:unitId` (writeGuard) → removes unit; re-syncs counts. Audit `delete_unit`.
- `POST /api/issue` → body adds optional `itemUnitId`. Unique+units: requires a valid in-stock unit, marks it issued and sets `assignment.itemUnitId`. Unique without units: legacy quantity fallback. Non-unique: decrement.
- `POST /api/return/:id` → for unique assignments with `itemUnitId`, flips that unit back to in_stock (or maintenance if `requiresInspection`), clears `assignedOfficerId`.
- `POST /api/kits/:id/issue` → body `{officerId, issuedBy?, dueDate?, signature?, notes?, unitSelections:{<itemId>:<itemUnitId>}}`. Pre-validates serialized lines: 400 `No available <item> units in stock — add a unit or remove it from the kit.` / 400 `Select a serial/unit for <item> before issuing the kit.` Response `{issued, skipped}`.
- `PATCH /api/assignments/:id/unit` (writeGuard) → `{itemUnitId, actor?}`. Validates unit belongs to the same item and is available (or already this assignment's); releases the old unit, marks the new one issued, updates `assignment.itemUnitId`. 400 `Invalid unit for this item.` on mismatch. Audit `assign_unit`.

## Kit feature behavior
- Serial is REQUIRED for each serialized (`unique`) item in the kit; one serialized item per kit is the common case but multiple are supported.
- Issue is blocked (client disables + server 400) if any serialized line has no in-stock unit, or any selection is missing — all-or-nothing pre-validation before any mutation.
- After issue, the unit on an officer's assignment can be set/replaced via the officer detail sheet (PATCH endpoint above).

## Verification
- `npx tsc --noEmit` → clean.
- `npm run build` → success (dist/public + dist/index.cjs).
- Local QA against a fresh seeded encrypted DB on port 5000 (all passed):
  - Add dual-serial vest units + single-serial radio units; `unitCounts`/quantity sync correctly.
  - Issue a unit → unit flips to issued, counts update, assignment carries `itemUnitId`.
  - PATCH reassign → old unit released to in_stock, new unit issued.
  - Return → unit flips back to in_stock.
  - Kit issue without selections → 400 with clear message; with selections → `{issued:2,skipped:[]}` and correct units marked.
  - Kit with a zero-stock serialized item → 400 no-stock block.
  - Cross-item PATCH → 400 `Invalid unit for this item.`
  - Delete in-stock unit + PATCH unit to maintenance → counts reflect (`maintenance` bucket increments).
