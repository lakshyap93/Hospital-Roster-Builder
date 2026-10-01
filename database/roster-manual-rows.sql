-- Persist editable blank roster rows and their entered values per saved roster.
BEGIN;

CREATE TABLE IF NOT EXISTS public.roster_manual_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id uuid NOT NULL REFERENCES public.rosters(id) ON DELETE CASCADE,
  row_key text NOT NULL,
  sort_order integer NOT NULL DEFAULT 1,
  name text NOT NULL DEFAULT '',
  unid_no text NOT NULL DEFAULT '',
  duties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roster_manual_rows_roster_key_unique UNIQUE (roster_id, row_key)
);

ALTER TABLE public.roster_manual_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.roster_manual_rows FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.roster_manual_rows TO authenticated;

DROP POLICY IF EXISTS roster_manual_rows_signed_in_workspace_access ON public.roster_manual_rows;
CREATE POLICY roster_manual_rows_signed_in_workspace_access
  ON public.roster_manual_rows
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMIT;
