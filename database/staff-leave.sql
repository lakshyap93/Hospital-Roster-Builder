-- Staff leave log for the shared Hospital Roster Builder workspace.
BEGIN;

CREATE TABLE IF NOT EXISTS public.staff_leaves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  staff_name text NOT NULL,
  unid_no text,
  leave_start date NOT NULL,
  leave_end date NOT NULL,
  note text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_leaves_valid_date_range CHECK (leave_end >= leave_start)
);

CREATE INDEX IF NOT EXISTS staff_leaves_date_idx
  ON public.staff_leaves (leave_start DESC, leave_end DESC);

ALTER TABLE public.staff_leaves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.staff_leaves FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON TABLE public.staff_leaves TO authenticated;

DROP POLICY IF EXISTS staff_leaves_signed_in_workspace_select ON public.staff_leaves;
CREATE POLICY staff_leaves_signed_in_workspace_select
  ON public.staff_leaves FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS staff_leaves_signed_in_workspace_insert ON public.staff_leaves;
CREATE POLICY staff_leaves_signed_in_workspace_insert
  ON public.staff_leaves FOR INSERT TO authenticated
  WITH CHECK (created_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS staff_leaves_signed_in_workspace_delete ON public.staff_leaves;
CREATE POLICY staff_leaves_signed_in_workspace_delete
  ON public.staff_leaves FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) IS NOT NULL);

COMMIT;
