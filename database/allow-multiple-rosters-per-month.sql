-- Run this in the database SQL editor only if saving a second roster for the
-- same month/year shows the "Database rule prevents another roster" message.
-- It removes only a UNIQUE constraint on (month, year) from public.rosters.
DO $$
DECLARE
  unique_rule RECORD;
  normalized_definition TEXT;
BEGIN
  IF to_regclass('public.rosters') IS NULL THEN
    RAISE EXCEPTION 'Table public.rosters was not found';
  END IF;

  FOR unique_rule IN
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'public.rosters'::regclass
      AND contype = 'u'
  LOOP
    normalized_definition := regexp_replace(
      lower(unique_rule.definition),
      '[[:space:]"]',
      '',
      'g'
    );

    IF normalized_definition IN (
      'unique(month,year)',
      'unique(year,month)'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.rosters DROP CONSTRAINT %I',
        unique_rule.conname
      );
    END IF;
  END LOOP;
END $$;
