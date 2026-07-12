BEGIN;

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS company_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS company_acronym TEXT,
  ADD COLUMN IF NOT EXISTS company_legal_form TEXT,
  ADD COLUMN IF NOT EXISTS company_rccm TEXT,
  ADD COLUMN IF NOT EXISTS company_national_id TEXT,
  ADD COLUMN IF NOT EXISTS company_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS company_address TEXT,
  ADD COLUMN IF NOT EXISTS company_commune TEXT,
  ADD COLUMN IF NOT EXISTS company_city TEXT,
  ADD COLUMN IF NOT EXISTS company_country TEXT,
  ADD COLUMN IF NOT EXISTS legal_representative_name TEXT,
  ADD COLUMN IF NOT EXISTS legal_representative_title TEXT,
  ADD COLUMN IF NOT EXISTS default_lease_duration_months INTEGER,
  ADD COLUMN IF NOT EXISTS default_notice_months INTEGER,
  ADD COLUMN IF NOT EXISTS default_guarantee_months INTEGER,
  ADD COLUMN IF NOT EXISTS default_signature_place VARCHAR(180),
  ADD COLUMN IF NOT EXISTS default_lease_usage VARCHAR(120),
  ADD COLUMN IF NOT EXISTS default_contract_template_code VARCHAR(80);

UPDATE company_settings
SET company_legal_name = COALESCE(company_legal_name, legal_name, company_name),
    company_address = COALESCE(company_address, address),
    company_city = COALESCE(company_city, 'Kinshasa'),
    company_country = COALESCE(company_country, 'RDC'),
    default_lease_duration_months = COALESCE(default_lease_duration_months, 12),
    default_notice_months = COALESCE(default_notice_months, 1),
    default_guarantee_months = COALESCE(default_guarantee_months, 3),
    default_signature_place = COALESCE(default_signature_place, company_city, 'Kinshasa'),
    default_lease_usage = COALESCE(default_lease_usage, 'RESIDENTIAL'),
    default_contract_template_code = COALESCE(default_contract_template_code, 'LEASE_RESIDENTIAL')
WHERE deleted_at IS NULL;

COMMIT;
