ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS attachment_file_name VARCHAR(220);
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS attachment_file_url TEXT;
ALTER TABLE maintenance_requests ADD COLUMN IF NOT EXISTS internal_notes TEXT;
