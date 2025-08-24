-- Add AI processing tracking to questionnaires table

ALTER TABLE questionnaires 
ADD COLUMN ai_processing_attempted BOOLEAN DEFAULT FALSE,
ADD COLUMN ai_processing_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN ai_processing_completed_at TIMESTAMP WITH TIME ZONE;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_questionnaires_ai_processing ON questionnaires(ai_processing_attempted, ai_processing_started_at);

-- Update existing questionnaires to check if they have any ai_generated items
UPDATE questionnaires 
SET ai_processing_attempted = TRUE,
    ai_processing_started_at = created_at
WHERE id IN (
  SELECT DISTINCT questionnaire_id 
  FROM questionnaire_items 
  WHERE status = 'ai_generated' OR draft_answer IS NOT NULL
);
