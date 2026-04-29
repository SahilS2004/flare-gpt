-- Add a column to store extracted document text so we can attach the full
-- content to chat prompts without re-fetching from blob storage.
ALTER TABLE documents ADD COLUMN content TEXT;
