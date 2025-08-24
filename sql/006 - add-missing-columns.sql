-- Add missing columns to dataset_files table

-- Add file_type column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'dataset_files' AND column_name = 'file_type') THEN
        ALTER TABLE dataset_files ADD COLUMN file_type TEXT;
    END IF;
END $$;

-- Add status column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'dataset_files' AND column_name = 'status') THEN
        ALTER TABLE dataset_files ADD COLUMN status TEXT DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed'));
    END IF;
END $$;

-- Update existing records to have a default status
UPDATE dataset_files SET status = 'completed' WHERE status IS NULL;
