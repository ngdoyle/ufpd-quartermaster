-- Batch 7 (#16) — Ten dummy business personnel cards.
-- Realistic tactical / police-supply vendor names, inserted as officers with
-- type = 'business'. For a business the app stores the vendor name in
-- "firstName"; "lastName" and "badgeNumber" are NOT NULL in the schema so they
-- are set to empty strings (matching how the app's "Add Business" form persists
-- them). Emails use the plus-addressing convention
-- ufpdquartermaster+<businessname>@gmail.com where <businessname> is the
-- lowercase alphanumeric form of the vendor name.
--
-- Idempotent: each INSERT is guarded by WHERE NOT EXISTS on the business name,
-- so re-applying this file (e.g. at prod publish time) will not create
-- duplicates. Column identifiers are quoted camelCase to match migration.sql.

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Gator Tactical Supply', '', 'ufpdquartermaster+gatortacticalsupply@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Gator Tactical Supply');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Swamp City Uniforms', '', 'ufpdquartermaster+swampcityuniforms@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Swamp City Uniforms');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Alligator Arms and Ammo', '', 'ufpdquartermaster+alligatorarmsandammo@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Alligator Arms and Ammo');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Sunshine State Duty Gear', '', 'ufpdquartermaster+sunshinestatedutygear@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Sunshine State Duty Gear');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Everglades Body Armor', '', 'ufpdquartermaster+evergladesbodyarmor@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Everglades Body Armor');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Palmetto Police Supply', '', 'ufpdquartermaster+palmettopolicesupply@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Palmetto Police Supply');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Orange County Outfitters', '', 'ufpdquartermaster+orangecountyoutfitters@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Orange County Outfitters');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Cypress Tactical Solutions', '', 'ufpdquartermaster+cypresstacticalsolutions@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Cypress Tactical Solutions');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Sabal Firearms Depot', '', 'ufpdquartermaster+sabalfirearmsdepot@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Sabal Firearms Depot');

INSERT INTO officers ("badgeNumber", "firstName", "lastName", "email", "status", "type")
SELECT '', 'Manatee Duty Equipment', '', 'ufpdquartermaster+manateedutyequipment@gmail.com', 'active', 'business'
WHERE NOT EXISTS (SELECT 1 FROM officers WHERE "type" = 'business' AND "firstName" = 'Manatee Duty Equipment');
