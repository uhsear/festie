-- 076_crew_poll_answers.sql
-- Polls get an end time UI, multi-answer, one reminder per poll, and a decided list.
-- Existing polls stay single-answer. option_index keeps the first choice for old readers.
ALTER TABLE crew_polls ADD COLUMN IF NOT EXISTS multi_answer BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE crew_polls ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE crew_polls ADD COLUMN IF NOT EXISTS nudged_at TIMESTAMPTZ;
ALTER TABLE crew_poll_votes ADD COLUMN IF NOT EXISTS option_indexes INTEGER[];
