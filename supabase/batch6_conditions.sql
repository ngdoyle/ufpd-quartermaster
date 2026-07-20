-- Batch 6 (change round 7/20) item #10 — normalize condition vocabulary.
-- Allowed conditions are now EXACTLY (ALL CAPS):
--   NEW, LIKE NEW, GOOD, FAIR, DAMAGED, MAINTENANCE, RETIRED
-- This migrates existing rows from the old mixed-case values.
-- Idempotent + case-insensitive: safe to re-run. Already applied on dev.
--
-- Note: legacy "Poor" has no equivalent in the new list and is folded into
-- FAIR (its nearest neighbour), matching the client normalizeCondition() helper.

-- Serialized unit conditions.
UPDATE item_units SET condition = 'NEW'         WHERE lower(trim(condition)) = 'new';
UPDATE item_units SET condition = 'LIKE NEW'    WHERE lower(trim(condition)) = 'like new';
UPDATE item_units SET condition = 'GOOD'        WHERE lower(trim(condition)) = 'good';
UPDATE item_units SET condition = 'FAIR'        WHERE lower(trim(condition)) = 'fair';
UPDATE item_units SET condition = 'FAIR'        WHERE lower(trim(condition)) = 'poor';
UPDATE item_units SET condition = 'DAMAGED'     WHERE lower(trim(condition)) = 'damaged';
UPDATE item_units SET condition = 'MAINTENANCE' WHERE lower(trim(condition)) = 'maintenance';
UPDATE item_units SET condition = 'RETIRED'     WHERE lower(trim(condition)) = 'retired';

-- Item-level conditions (non-serialized items store condition on the item row).
UPDATE items SET condition = 'NEW'         WHERE lower(trim(condition)) = 'new';
UPDATE items SET condition = 'LIKE NEW'    WHERE lower(trim(condition)) = 'like new';
UPDATE items SET condition = 'GOOD'        WHERE lower(trim(condition)) = 'good';
UPDATE items SET condition = 'FAIR'        WHERE lower(trim(condition)) = 'fair';
UPDATE items SET condition = 'FAIR'        WHERE lower(trim(condition)) = 'poor';
UPDATE items SET condition = 'DAMAGED'     WHERE lower(trim(condition)) = 'damaged';
UPDATE items SET condition = 'MAINTENANCE' WHERE lower(trim(condition)) = 'maintenance';
UPDATE items SET condition = 'RETIRED'     WHERE lower(trim(condition)) = 'retired';

-- Assignment condition snapshots. NOTE: assignments uses quoted camelCase
-- columns ("conditionOut" recorded at issuance, "conditionIn" recorded on return).
UPDATE assignments SET "conditionOut" = 'NEW'         WHERE lower(trim("conditionOut")) = 'new';
UPDATE assignments SET "conditionOut" = 'LIKE NEW'    WHERE lower(trim("conditionOut")) = 'like new';
UPDATE assignments SET "conditionOut" = 'GOOD'        WHERE lower(trim("conditionOut")) = 'good';
UPDATE assignments SET "conditionOut" = 'FAIR'        WHERE lower(trim("conditionOut")) = 'fair';
UPDATE assignments SET "conditionOut" = 'FAIR'        WHERE lower(trim("conditionOut")) = 'poor';
UPDATE assignments SET "conditionOut" = 'DAMAGED'     WHERE lower(trim("conditionOut")) = 'damaged';
UPDATE assignments SET "conditionOut" = 'MAINTENANCE' WHERE lower(trim("conditionOut")) = 'maintenance';
UPDATE assignments SET "conditionOut" = 'RETIRED'     WHERE lower(trim("conditionOut")) = 'retired';

UPDATE assignments SET "conditionIn" = 'NEW'         WHERE lower(trim("conditionIn")) = 'new';
UPDATE assignments SET "conditionIn" = 'LIKE NEW'    WHERE lower(trim("conditionIn")) = 'like new';
UPDATE assignments SET "conditionIn" = 'GOOD'        WHERE lower(trim("conditionIn")) = 'good';
UPDATE assignments SET "conditionIn" = 'FAIR'        WHERE lower(trim("conditionIn")) = 'fair';
UPDATE assignments SET "conditionIn" = 'FAIR'        WHERE lower(trim("conditionIn")) = 'poor';
UPDATE assignments SET "conditionIn" = 'DAMAGED'     WHERE lower(trim("conditionIn")) = 'damaged';
UPDATE assignments SET "conditionIn" = 'MAINTENANCE' WHERE lower(trim("conditionIn")) = 'maintenance';
UPDATE assignments SET "conditionIn" = 'RETIRED'     WHERE lower(trim("conditionIn")) = 'retired';
