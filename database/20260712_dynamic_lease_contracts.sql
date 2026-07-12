BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS legal_form VARCHAR(120),
  ADD COLUMN IF NOT EXISTS national_id_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS commune VARCHAR(120),
  ADD COLUMN IF NOT EXISTS city VARCHAR(120),
  ADD COLUMN IF NOT EXISTS country VARCHAR(120),
  ADD COLUMN IF NOT EXISTS representative_post_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS representative_first_name VARCHAR(120);

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS company_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS company_acronym TEXT,
  ADD COLUMN IF NOT EXISTS company_legal_form TEXT,
  ADD COLUMN IF NOT EXISTS company_rccm TEXT,
  ADD COLUMN IF NOT EXISTS company_national_id TEXT,
  ADD COLUMN IF NOT EXISTS company_tax_id TEXT,
  ADD COLUMN IF NOT EXISTS company_commune TEXT,
  ADD COLUMN IF NOT EXISTS company_city TEXT,
  ADD COLUMN IF NOT EXISTS company_country TEXT,
  ADD COLUMN IF NOT EXISTS legal_representative_name TEXT,
  ADD COLUMN IF NOT EXISTS legal_representative_title TEXT;

UPDATE company_settings
SET company_legal_name = COALESCE(company_legal_name, legal_name, company_name),
    company_city = COALESCE(company_city, 'Kinshasa'),
    company_country = COALESCE(company_country, 'RDC')
WHERE deleted_at IS NULL;

ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(140);

ALTER TABLE units
  ADD COLUMN IF NOT EXISTS parking_spaces_count INTEGER,
  ADD COLUMN IF NOT EXISTS usage_type VARCHAR(120);

ALTER TABLE leases
  ADD COLUMN IF NOT EXISTS notice_months INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS maintenance_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS other_charges_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guarantee_months INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS signature_place VARCHAR(180),
  ADD COLUMN IF NOT EXISTS signature_date DATE,
  ADD COLUMN IF NOT EXISTS lease_usage VARCHAR(120),
  ADD COLUMN IF NOT EXISTS contract_template_code VARCHAR(80),
  ADD COLUMN IF NOT EXISTS generated_contract_file_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS generated_contract_url TEXT,
  ADD COLUMN IF NOT EXISTS contract_generated_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS signed_contract_file_name VARCHAR(220),
  ADD COLUMN IF NOT EXISTS signed_contract_url TEXT,
  ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMP;

UPDATE leases
SET lease_total_amount = COALESCE(monthly_rent, 0)
  + COALESCE(maintenance_fee_amount, 0)
  + COALESCE(monthly_syndic_amount, 0)
  + COALESCE(other_charges_amount, 0)
WHERE COALESCE(lease_total_amount, 0) = 0;

CREATE TABLE IF NOT EXISTS lease_contract_templates (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  name VARCHAR(180) NOT NULL,
  code VARCHAR(80) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  lease_type VARCHAR(80) NOT NULL DEFAULT 'RESIDENTIAL',
  content TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES app_users(id),
  updated_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP,
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id),
  UNIQUE (organization_id, code, version)
);

CREATE TABLE IF NOT EXISTS lease_contract_generations (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  template_id INTEGER NOT NULL REFERENCES lease_contract_templates(id),
  template_version INTEGER NOT NULL,
  generated_content TEXT NOT NULL,
  generated_html TEXT NOT NULL,
  snapshot_json JSONB NOT NULL DEFAULT '{}'::JSONB,
  pdf_file_name VARCHAR(220),
  pdf_file_url TEXT,
  signed_contract_file_name VARCHAR(220),
  signed_contract_file_url TEXT,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  generated_by INTEGER REFERENCES app_users(id),
  printed_at TIMESTAMP,
  signed_at TIMESTAMP,
  uploaded_by INTEGER REFERENCES app_users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'GENERATED'
    CHECK (status IN ('DRAFT', 'GENERATED', 'PRINTED', 'SIGNED', 'CANCELLED')),
  deleted_at TIMESTAMP,
  deleted_by INTEGER REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS lease_contract_generations_lease_idx
  ON lease_contract_generations (organization_id, lease_id, generated_at DESC)
  WHERE deleted_at IS NULL;

INSERT INTO lease_contract_templates (
  organization_id,
  name,
  code,
  version,
  lease_type,
  content,
  is_active,
  created_by
)
SELECT
  organization_id,
  'Contrat de bail a usage residentiel',
  'LEASE_RESIDENTIAL',
  1,
  'RESIDENTIAL',
  $$CONTRAT DE BAIL A USAGE RESIDENTIEL

Entre les soussignes :

LE BAILLEUR
{{bailleur.presentation}}

ET

LE PRENEUR
{{locataire.presentation}}

Il a ete convenu ce qui suit :

ARTICLE 1 - OBJET DU BAIL
Le Bailleur donne en location au Preneur le bien situe a {{bien.adresse_complete}}, dans l'immeuble {{bien.immeuble}}, unite {{bien.numero_unite}}, pour un usage {{bail.usage_label}}.

ARTICLE 2 - DESCRIPTION DU BIEN
Le bien loue comprend {{bien.description_detail}}.

ARTICLE 3 - DUREE
Le present bail prend effet le {{bail.date_debut}} et prend fin le {{bail.date_fin}}, pour une duree de {{bail.duree_texte}}.

ARTICLE 4 - LOYER ET CHARGES
Le loyer de base est fixe a {{bail.loyer_base}} {{bail.devise}}.
Les frais d'entretien s'elevent a {{bail.frais_entretien}} {{bail.devise}}.
Les frais de syndic s'elevent a {{bail.frais_syndic}} {{bail.devise}}.
Les autres charges s'elevent a {{bail.autres_charges}} {{bail.devise}}.
Le loyer total mensuel du bail est donc fixe a {{bail.loyer_total}} {{bail.devise}}.

ARTICLE 5 - GARANTIE
Le Preneur verse une garantie equivalente a {{bail.garantie_nombre_mois}} mois, soit {{bail.garantie_montant}} {{bail.devise}}.

ARTICLE 6 - PREAVIS
Le delai de preavis applicable est de {{bail.preavis_mois}} mois.

ARTICLE 7 - OBLIGATIONS GENERALES
Le Preneur s'engage a user paisiblement du bien, a respecter sa destination et a ne pas sous-louer sans accord ecrit prealable du Bailleur.

ARTICLE 8 - SIGNATURE
Fait a {{bail.lieu_signature}}, le {{bail.date_signature}}.

LE BAILLEUR
{{bailleur.signature_nom}}

LE PRENEUR
{{locataire.signature_nom}}$$,
  TRUE,
  1
FROM company_settings
ON CONFLICT (organization_id, code, version) DO NOTHING;

COMMIT;
