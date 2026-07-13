BEGIN;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT mime_type
  FROM unnest(
    COALESCE(
      allowed_mime_types,
      ARRAY[]::text[]
    ) || ARRAY['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  ) AS mime_type
)
WHERE id = 'contracts';

COMMIT;
