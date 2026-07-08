ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS piece_number VARCHAR(20);
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS label VARCHAR(160);
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS supplier VARCHAR(180);
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS attachment_file_name VARCHAR(220);
ALTER TABLE cash_movements ADD COLUMN IF NOT EXISTS attachment_file_url TEXT;
