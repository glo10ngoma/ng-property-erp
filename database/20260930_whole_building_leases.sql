-- Location d'un immeuble entier sans compter l'unite contractuelle dans le patrimoine physique.
ALTER TABLE units
  ADD COLUMN IF NOT EXISTS is_building_wide BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS units_one_building_wide_contract_unit
  ON units (organization_id, building_id)
  WHERE is_building_wide = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS units_building_wide_lookup_idx
  ON units (organization_id, building_id, is_building_wide)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN units.is_building_wide IS
  'Unite contractuelle non physique utilisee pour un bail portant sur tout l immeuble.';
