-- 079_crew_money.sql
-- Crew money. Per-crew currency label, uneven shares, edit trail,
-- payee confirmation, and once-a-day settle-up reminders. Additive only.
ALTER TABLE crews ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'
  CHECK (currency ~ '^[A-Z]{3}$');
ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS split_amounts JSONB;
ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS updated_by TEXT;
ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE crew_expenses ADD COLUMN IF NOT EXISTS disputed_at TIMESTAMPTZ;
-- Payments made before payee confirmation existed count as confirmed, so payees
-- are not asked about old history. Settle-up sets created_by from 079 on, so
-- created_by IS NULL marks only pre-079 rows and a re-run changes nothing new.
UPDATE crew_expenses SET confirmed_at = created_at
  WHERE category = 'settlement' AND created_by IS NULL
    AND confirmed_at IS NULL AND disputed_at IS NULL;
-- from_user_id is the creditor who sent the reminder; to_user_id is the debtor.
CREATE TABLE IF NOT EXISTS crew_expense_reminders (
  crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_on DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (crew_id, from_user_id, to_user_id, sent_on)
);
