BEGIN;

CREATE TABLE IF NOT EXISTS modules_catalog (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NULL,
  category TEXT NOT NULL,
  icon TEXT NULL,
  is_core BOOLEAN NOT NULL DEFAULT FALSE,
  is_assignable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT modules_catalog_code_format_chk CHECK (code = UPPER(code) AND code ~ '^[A-Z][A-Z0-9_]*$'),
  CONSTRAINT modules_catalog_sort_order_chk CHECK (sort_order >= 0),
  CONSTRAINT modules_catalog_dependencies_array_chk CHECK (
    jsonb_typeof(dependencies) = 'array'
    AND NOT jsonb_path_exists(dependencies, '$[*] ? (@.type() != "string")')
  )
);

ALTER TABLE modules_catalog
  ADD COLUMN IF NOT EXISTS icon TEXT NULL,
  ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_assignable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO modules_catalog (code, label, description, category, icon, is_core, is_assignable, is_active, sort_order, dependencies)
VALUES
  ('CORE', 'Noyau applicatif', 'Paramètres généraux et session.', 'PLATFORM', 'layers', TRUE, FALSE, TRUE, 10, '[]'::jsonb),
  ('BUILDINGS', 'Immeubles', 'Gestion des immeubles.', 'PROPERTY', 'building-2', FALSE, TRUE, TRUE, 20, '["CORE"]'::jsonb),
  ('UNITS', 'Unités locatives', 'Gestion des appartements et unités.', 'PROPERTY', 'home', FALSE, TRUE, TRUE, 30, '["BUILDINGS"]'::jsonb),
  ('TENANTS', 'Locataires', 'Gestion des locataires.', 'PROPERTY', 'users', FALSE, TRUE, TRUE, 40, '["UNITS"]'::jsonb),
  ('LEASES', 'Baux', 'Gestion des baux et contrats.', 'PROPERTY', 'scroll-text', FALSE, TRUE, TRUE, 50, '["TENANTS"]'::jsonb),
  ('FINANCE', 'Finance', 'Factures, paiements et synthèse financière.', 'FINANCE', 'credit-card', FALSE, TRUE, TRUE, 60, '["CORE"]'::jsonb),
  ('CASH', 'Caisse principale', 'Mouvements de caisse principale.', 'FINANCE', 'wallet-cards', FALSE, TRUE, TRUE, 70, '["FINANCE"]'::jsonb),
  ('BANKING', 'Banque', 'Comptes bancaires et transactions.', 'FINANCE', 'landmark', FALSE, TRUE, TRUE, 80, '["FINANCE"]'::jsonb),
  ('GUARANTEE_CASH', 'Caisse garanties', 'Garanties locatives et encaissements associés.', 'FINANCE', 'shield-check', FALSE, TRUE, TRUE, 90, '["FINANCE"]'::jsonb),
  ('STOCK', 'Stock', 'Articles, mouvements et inventaires.', 'OPERATIONS', 'boxes', FALSE, TRUE, TRUE, 100, '["CORE"]'::jsonb),
  ('MAINTENANCE', 'Maintenance', 'Demandes, interventions et suivi technique.', 'OPERATIONS', 'wrench', FALSE, TRUE, TRUE, 110, '["BUILDINGS"]'::jsonb),
  ('HR', 'Ressources humaines', 'Employés, contrats et paie.', 'OPERATIONS', 'briefcase-business', FALSE, TRUE, TRUE, 120, '["CORE"]'::jsonb),
  ('DOCUMENTS', 'Documents', 'Bibliothèque documentaire et pièces jointes.', 'PLATFORM', 'folder-open', FALSE, TRUE, TRUE, 130, '["CORE"]'::jsonb),
  ('COMMUNICATION', 'Communication', 'Emails, SMS, journaux et notifications.', 'PLATFORM', 'message-square', FALSE, TRUE, TRUE, 140, '["CORE"]'::jsonb),
  ('REPORTS', 'Rapports', 'Rapports et exports métier.', 'PLATFORM', 'file-text', FALSE, TRUE, TRUE, 150, '["CORE"]'::jsonb),
  ('WORKFLOW', 'Workflow', 'Circuits d’approbation et tâches.', 'PLATFORM', 'workflow', FALSE, TRUE, TRUE, 160, '["CORE"]'::jsonb),
  ('SALES', 'Ventes immobilières', 'Réservations, souscriptions et recouvrement commercial.', 'COMMERCIAL', 'line-chart', FALSE, TRUE, TRUE, 170, '["CORE","FINANCE"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS suspended_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS reactivated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reactivated_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS reactivation_reason TEXT NULL;

ALTER TABLE organization_modules
  ADD COLUMN IF NOT EXISTS enabled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS enabled_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS disabled_by BIGINT NULL,
  ADD COLUMN IF NOT EXISTS disable_reason TEXT NULL;

DO $$
DECLARE
  orphan_codes TEXT;
BEGIN
  SELECT string_agg(unknown_code, ', ' ORDER BY unknown_code)
  INTO orphan_codes
  FROM (
    SELECT DISTINCT om.module_code AS unknown_code
    FROM organization_modules om
    LEFT JOIN modules_catalog mc ON mc.code = om.module_code
    WHERE mc.code IS NULL
  ) missing_codes;

  IF orphan_codes IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown organization_modules.module_code values: %', orphan_codes;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organization_modules_module_code_fk'
  ) THEN
    ALTER TABLE organization_modules
      ADD CONSTRAINT organization_modules_module_code_fk
      FOREIGN KEY (module_code)
      REFERENCES modules_catalog(code)
      ON UPDATE RESTRICT
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE modules_catalog ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_modules_catalog_category ON modules_catalog(category, sort_order, code);
CREATE INDEX IF NOT EXISTS idx_organizations_status_slug ON organizations(status, slug);
CREATE INDEX IF NOT EXISTS idx_organization_modules_enabled_lookup ON organization_modules(organization_id, is_enabled, module_code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_modules_unique_module ON organization_modules(organization_id, module_code);

COMMIT;
