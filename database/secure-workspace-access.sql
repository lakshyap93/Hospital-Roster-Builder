-- Security remediation for the shared Hospital Roster Builder workspace.
-- Run once in the Supabase SQL editor after reviewing the workspace model:
-- all pre-provisioned signed-in users share this hospital's staff and rosters.
-- Anonymous users receive no table privileges or RLS policies.

BEGIN;

DO $$
DECLARE
  table_name TEXT;
  existing_policy RECORD;
  target_tables TEXT[] := ARRAY[
    'staff',
    'rosters',
    'roster_staff_snapshots',
    'roster_assignments'
  ];
BEGIN
  FOREACH table_name IN ARRAY target_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'Required table public.% is missing; no access changes were committed', table_name;
    END IF;
  END LOOP;

  -- Remove all existing policies on these shared-workspace tables so an old
  -- permissive anon/PUBLIC policy cannot continue exposing rows.
  FOR existing_policy IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(target_tables)
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I',
      existing_policy.policyname,
      existing_policy.schemaname,
      existing_policy.tablename);
  END LOOP;

  FOREACH table_name IN ARRAY target_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      table_name || '_signed_in_workspace_access',
      table_name);
  END LOOP;
END $$;

COMMIT;
