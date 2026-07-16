BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS civility VARCHAR(10),
  ADD COLUMN IF NOT EXISTS legal_representative_civility VARCHAR(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_civility_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_civility_check
      CHECK (civility IS NULL OR civility IN ('MR', 'MRS'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenants_legal_representative_civility_check'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_legal_representative_civility_check
      CHECK (
        legal_representative_civility IS NULL
        OR legal_representative_civility IN ('MR', 'MRS')
      );
  END IF;
END $$;

COMMIT;
