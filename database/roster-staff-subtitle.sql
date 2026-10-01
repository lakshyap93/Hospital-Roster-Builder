-- Persist optional per-roster staff subtitles (unit, assignment, role, etc.).
ALTER TABLE public.roster_staff_snapshots
  ADD COLUMN IF NOT EXISTS subtitle text NOT NULL DEFAULT '';
