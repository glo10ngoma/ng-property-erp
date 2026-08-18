BEGIN;

CREATE TABLE IF NOT EXISTS sales_number_sequences (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  sequence_year INTEGER,
  current_value BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_number_sequences_document_type_chk
    CHECK (document_type IN (
      'BUYER',
      'PROJECT',
      'CATALOG',
      'RESERVATION',
      'SUBSCRIPTION',
      'RESERVATION_CONTRACT',
      'SUBSCRIPTION_CONTRACT'
    )),
  CONSTRAINT sales_number_sequences_current_value_chk
    CHECK (current_value >= 0),
  CONSTRAINT sales_number_sequences_year_chk
    CHECK (sequence_year IS NULL OR sequence_year >= 2000)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_number_sequences_org_type_year_uidx
  ON sales_number_sequences (organization_id, document_type, sequence_year);

ALTER TABLE sales_settings
  ADD COLUMN IF NOT EXISTS buyer_number_format TEXT NOT NULL DEFAULT 'ACQ-{YYYY}-{SEQ:5}',
  ADD COLUMN IF NOT EXISTS project_number_format TEXT NOT NULL DEFAULT 'PRJ-{YYYY}-{SEQ:4}',
  ADD COLUMN IF NOT EXISTS catalog_number_format TEXT NOT NULL DEFAULT 'BIE-{YYYY}-{SEQ:5}',
  ADD COLUMN IF NOT EXISTS reservation_number_format TEXT NOT NULL DEFAULT 'RSV-{YYYY}-{SEQ:5}',
  ADD COLUMN IF NOT EXISTS subscription_number_format TEXT NOT NULL DEFAULT 'SOU-{YYYY}-{SEQ:5}',
  ADD COLUMN IF NOT EXISTS reservation_contract_number_format TEXT NOT NULL DEFAULT 'CR-{YYYY}-{SEQ:5}',
  ADD COLUMN IF NOT EXISTS subscription_contract_number_format TEXT NOT NULL DEFAULT 'CV-{YYYY}-{SEQ:5}';

CREATE TABLE IF NOT EXISTS sales_document_templates (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_type TEXT NOT NULL,
  title TEXT NOT NULL,
  template_body TEXT NOT NULL,
  header_html TEXT,
  footer_html TEXT,
  variables_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  clause_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT sales_document_templates_type_chk
    CHECK (template_type IN ('RESERVATION_CONTRACT', 'SUBSCRIPTION_CONTRACT')),
  CONSTRAINT sales_document_templates_version_chk
    CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_document_templates_org_type_version_uidx
  ON sales_document_templates (organization_id, template_type, version);

CREATE UNIQUE INDEX IF NOT EXISTS sales_document_templates_org_type_active_uidx
  ON sales_document_templates (organization_id, template_type)
  WHERE archived_at IS NULL AND is_active = TRUE;

CREATE TABLE IF NOT EXISTS sales_document_generations (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  template_type TEXT NOT NULL,
  template_id BIGINT REFERENCES sales_document_templates(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  document_number TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  variables_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  pdf_base64 TEXT,
  generation_status TEXT NOT NULL DEFAULT 'PENDING',
  generated_at TIMESTAMPTZ,
  generated_by BIGINT REFERENCES app_users(id) ON DELETE SET NULL,
  signed_at TIMESTAMPTZ,
  signed_file_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sales_document_generations_entity_type_chk
    CHECK (entity_type IN ('RESERVATION', 'SUBSCRIPTION')),
  CONSTRAINT sales_document_generations_template_type_chk
    CHECK (template_type IN ('RESERVATION_CONTRACT', 'SUBSCRIPTION_CONTRACT')),
  CONSTRAINT sales_document_generations_status_chk
    CHECK (generation_status IN ('PENDING', 'GENERATED', 'GENERATION_FAILED', 'SIGNED')),
  CONSTRAINT sales_document_generations_version_chk
    CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS sales_document_generations_org_entity_idx
  ON sales_document_generations (organization_id, entity_type, entity_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS sales_document_generations_org_number_uidx
  ON sales_document_generations (organization_id, document_number);

COMMIT;
