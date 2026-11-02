-- Add pcs_per_set to invoice_items
ALTER TABLE invoice_items 
ADD COLUMN IF NOT EXISTS pcs_per_set INT DEFAULT 1;

-- If you have any existing invoice items without pcs_per_set, this sets them to 1
UPDATE invoice_items 
SET pcs_per_set = 1 
WHERE pcs_per_set IS NULL;

-- Notify Supabase to reload the schema cache
NOTIFY pgrst, 'reload schema';
