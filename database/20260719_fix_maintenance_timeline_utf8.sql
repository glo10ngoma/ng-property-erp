BEGIN;

WITH legacy AS (
  SELECT
    convert_from(decode('44c383c2a970656e7365', 'hex'), 'UTF8') AS old_expense_title,
    convert_from(decode('312061727469636c6528732920636f6e736f6d6dc383c692c382c2a928732920706f757220332e303020555344', 'hex'), 'UTF8') AS old_stock_details,
    convert_from(decode('31206c69676e6528732920646520636fc383c2bb7420656e72656769737472c383c2a965287329', 'hex'), 'UTF8') AS old_expense_details
)
UPDATE maintenance_timeline timeline
SET
  title = CASE
    WHEN timeline.title = legacy.old_expense_title THEN 'Dépense'
    ELSE timeline.title
  END,
  details = CASE
    WHEN timeline.details = legacy.old_stock_details THEN '1 article consommé pour 3,00 USD'
    WHEN timeline.details = legacy.old_expense_details THEN '1 ligne de coût enregistrée'
    ELSE timeline.details
  END
FROM legacy
WHERE timeline.deleted_at IS NULL
  AND (
    timeline.title = legacy.old_expense_title
    OR timeline.details IN (legacy.old_stock_details, legacy.old_expense_details)
  );

COMMIT;
