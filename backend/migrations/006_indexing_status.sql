-- Track async vector indexing status per document. The upload route flips
-- a row to 'pending' when it enqueues the job, and the queue consumer flips it
-- to 'completed' / 'failed' / 'deferred' / 'skipped' once processing finishes.
ALTER TABLE documents ADD COLUMN indexing_status TEXT DEFAULT 'pending';
ALTER TABLE documents ADD COLUMN indexed_chunks INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN total_chunks INTEGER DEFAULT 0;
ALTER TABLE documents ADD COLUMN indexing_error TEXT;
ALTER TABLE documents ADD COLUMN indexed_at DATETIME;
