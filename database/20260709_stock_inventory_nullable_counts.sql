BEGIN;

ALTER TABLE inventory_count_lines
  ALTER COLUMN physical_quantity DROP NOT NULL,
  ALTER COLUMN physical_quantity DROP DEFAULT,
  ALTER COLUMN difference_quantity DROP NOT NULL,
  ALTER COLUMN difference_quantity DROP DEFAULT,
  ALTER COLUMN difference_cost DROP NOT NULL,
  ALTER COLUMN difference_cost DROP DEFAULT;

UPDATE inventory_count_lines icl
SET
  physical_quantity = NULL,
  difference_quantity = NULL,
  difference_cost = NULL
FROM inventory_counts ic
WHERE ic.id = icl.inventory_count_id
  AND icl.organization_id = ic.organization_id
  AND ic.status IN ('DRAFT', 'IN_PROGRESS');

COMMIT;
