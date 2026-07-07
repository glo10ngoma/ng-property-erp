ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS building_type VARCHAR(120) NOT NULL DEFAULT 'Residence';

UPDATE buildings
SET building_type = 'Residence'
WHERE building_type IS NULL OR building_type = '';
