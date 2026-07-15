-- ============================================================================
-- hardening.sql — Row-Level-Security hardening for the Quartermaster app.
--
-- The app talks to Supabase Postgres via supabase-js using the anon key,
-- server-side only. There is no Supabase Auth — auth is app-level (bcrypt users
-- table + bearer tokens). With RLS disabled, anyone who obtains the anon key
-- (which is a normal PostgREST credential, not a secret in the JWT sense) could
-- read/write every table directly. This file gates all PostgREST/RPC access on
-- a shared secret sent by the server as an `x-app-secret` request header.
--
-- Model: the server holds APP_DB_SECRET (env) and sends it on every request.
-- A SECURITY DEFINER helper compares that header against a value stored in a
-- private schema the anon role cannot read. RLS policies on all 9 public tables
-- allow access only when the header matches. Dashboard/owner sessions (which do
-- not go through PostgREST's `authenticator` role) are unaffected.
--
-- This script is IDEMPOTENT: safe to re-run. Apply it AFTER migration.sql.
-- Do NOT apply from the app's anon connection — run it in the Supabase SQL
-- editor (as the project owner) so the private objects are owned correctly.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Private schema + config table. The anon/authenticated roles get NO grants,
-- so the stored secret is unreadable except through the SECURITY DEFINER
-- helpers below (which run as the owner).
-- --------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);
-- Deliberately NO grants to anon/authenticated on the schema or table.

-- --------------------------------------------------------------------------
-- private.app_authorized(): true iff the request carries an x-app-secret header
-- matching the stored app_secret. Null-safe: returns false (never errors) when
-- the header is absent, the config row is missing, or the header collection is
-- unavailable (e.g. direct SQL sessions with no request context).
--
-- SECURITY DEFINER so it can read private.app_config even though the caller
-- (anon) has no privileges there. STABLE: depends only on the current request /
-- table state within a statement. search_path pinned per DEFINER hardening.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.app_authorized()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
  SELECT COALESCE(
    (current_setting('request.headers', true)::json ->> 'x-app-secret')
      = (SELECT value FROM private.app_config WHERE key = 'app_secret'),
    false
  );
$$;

-- --------------------------------------------------------------------------
-- set_app_secret(): one-time initialization of the shared secret via PostgREST
-- rpc. Refuses to overwrite an existing secret — rotation is done later by the
-- owner in the dashboard SQL editor. Lives in the public schema so PostgREST
-- exposes it as an RPC. SECURITY DEFINER so it can write to private.app_config.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_app_secret(p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.app_config WHERE key = 'app_secret') THEN
    RAISE EXCEPTION 'app secret already set';
  END IF;
  INSERT INTO private.app_config (key, value) VALUES ('app_secret', p_secret);
END;
$$;

-- --------------------------------------------------------------------------
-- Enable RLS on all 9 public tables and attach a single FOR ALL policy per
-- table gated on private.app_authorized(). Wrapping the call in a scalar
-- subselect makes Postgres treat it as an InitPlan — evaluated once per
-- statement rather than once per row.
--
-- Policies target the `anon` role (what PostgREST uses with the anon key). The
-- owner/postgres role bypasses RLS entirely, so dashboard access is unaffected.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','officers','items','item_units','item_variants',
    'assignments','kits','kit_items','audit_log'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY app_all ON public.%I FOR ALL TO anon '
      || 'USING ((SELECT private.app_authorized())) '
      || 'WITH CHECK ((SELECT private.app_authorized()))',
      t
    );
  END LOOP;
END;
$$;

-- --------------------------------------------------------------------------
-- Re-guard the privileged maintenance functions. These are SECURITY DEFINER
-- (owner-run), so RLS does NOT apply to their internal statements — an
-- unauthorized PostgREST caller could otherwise wipe/reset the whole DB by
-- invoking the RPC. Add a first-line guard: when invoked through PostgREST
-- (session_user = 'authenticator'), require a valid app secret. Direct
-- owner/postgres sessions (dashboard, data migration run as owner) are allowed.
--
-- NOTE: SECURITY DEFINER makes current_user the owner, so session_user is the
-- correct thing to check to distinguish a PostgREST call from an owner session.
-- search_path stays pinned to public, so private.app_authorized() is referenced
-- schema-qualified.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION truncate_all()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF session_user = 'authenticator' AND NOT private.app_authorized() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  TRUNCATE users, officers, items, item_units, item_variants,
           assignments, kits, kit_items, audit_log
    RESTART IDENTITY CASCADE;
END;
$$;

CREATE OR REPLACE FUNCTION reset_sequences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t text;
BEGIN
  IF session_user = 'authenticator' AND NOT private.app_authorized() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  FOREACH t IN ARRAY ARRAY['users','officers','items','item_units','item_variants',
                           'assignments','kits','kit_items','audit_log']
  LOOP
    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%L, %L),
                     COALESCE((SELECT max("id") FROM %I), 1),
                     (SELECT max("id") FROM %I) IS NOT NULL)',
      t, 'id', t, t);
  END LOOP;
END;
$$;
