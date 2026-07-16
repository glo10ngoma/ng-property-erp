BEGIN;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS legal_representative_civility VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'company_settings_legal_representative_civility_check'
  ) THEN
    ALTER TABLE company_settings
      ADD CONSTRAINT company_settings_legal_representative_civility_check
      CHECK (
        legal_representative_civility IS NULL
        OR legal_representative_civility IN ('MR', 'MRS')
      );
  END IF;
END $$;

COMMIT;
