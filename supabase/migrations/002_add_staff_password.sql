-- Add staff_password to admin_settings
ALTER TABLE admin_settings 
ADD COLUMN IF NOT EXISTS staff_password TEXT DEFAULT 'staff123';

-- Update the default seed to include the staff password if it was somehow missing, though DEFAULT should handle it
UPDATE admin_settings 
SET staff_password = 'staff123' 
WHERE staff_password IS NULL;
