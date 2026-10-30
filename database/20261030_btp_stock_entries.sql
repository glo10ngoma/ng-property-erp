BEGIN;
ALTER TABLE public.btp_stock_movements DROP CONSTRAINT IF EXISTS btp_stock_movements_movement_type_check;
ALTER TABLE public.btp_stock_movements ADD CONSTRAINT btp_stock_movements_movement_type_check CHECK (movement_type IN ('IN','OUT','RETURN','ADJUSTMENT'));
CREATE INDEX IF NOT EXISTS btp_stock_movements_balance_lookup_idx ON public.btp_stock_movements(organization_id,project_id,lower(trim(material_name)),lower(trim(unit))) WHERE deleted_at IS NULL;
COMMIT;
