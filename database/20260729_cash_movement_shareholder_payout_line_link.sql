BEGIN;

ALTER TABLE public.cash_movements
  ADD COLUMN IF NOT EXISTS shareholder_payout_line_id INTEGER;

UPDATE public.cash_movements cm
SET shareholder_payout_line_id = spl.id
FROM public.shareholder_payout_lines spl
WHERE spl.organization_id = cm.organization_id
  AND spl.cash_movement_id = cm.id
  AND cm.shareholder_payout_line_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_movements_shareholder_payout_line_id
  ON public.cash_movements (shareholder_payout_line_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cash_movements_shareholder_payout_line_id_fkey'
      AND conrelid = 'public.cash_movements'::regclass
  ) THEN
    ALTER TABLE public.cash_movements
      ADD CONSTRAINT cash_movements_shareholder_payout_line_id_fkey
      FOREIGN KEY (shareholder_payout_line_id)
      REFERENCES public.shareholder_payout_lines(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

COMMIT;
