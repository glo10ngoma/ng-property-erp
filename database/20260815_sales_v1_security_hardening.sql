BEGIN;

-- Supabase expose le schema public via sa Data API. Le backend ERP utilise sa
-- propre authentification et son propre contexte d'organisation : aucune
-- politique anon/authenticated n'est donc creee ici.
ALTER TABLE organization_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_buyers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_property_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_audit_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enforce_sales_catalog_organization_links()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_projects p
    WHERE p.id = NEW.project_id AND p.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'SALES_CATALOG_PROJECT_ORGANIZATION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.building_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM buildings b
    WHERE b.id = NEW.building_id AND b.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'SALES_CATALOG_BUILDING_ORGANIZATION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM units u
    WHERE u.id = NEW.unit_id AND u.organization_id = NEW.organization_id
  ) THEN
    RAISE EXCEPTION 'SALES_CATALOG_UNIT_ORGANIZATION_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION enforce_sales_catalog_organization_links() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'sales_catalog_organization_links_trigger'
      AND tgrelid = 'sales_property_catalog'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER sales_catalog_organization_links_trigger
      BEFORE INSERT OR UPDATE OF organization_id, project_id, building_id, unit_id
      ON sales_property_catalog
      FOR EACH ROW
      EXECUTE FUNCTION enforce_sales_catalog_organization_links();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_catalog_minimum_not_above_list'
      AND conrelid = 'sales_property_catalog'::regclass
  ) THEN
    ALTER TABLE sales_property_catalog
      ADD CONSTRAINT sales_catalog_minimum_not_above_list
      CHECK (
        minimum_price IS NULL OR list_price IS NULL OR minimum_price <= list_price
      );
  END IF;
END;
$$;

COMMIT;
