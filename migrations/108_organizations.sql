-- 108_organizations.sql
-- Tenancy core for the organizer platform. An organization owns festivals and has members with a role.
-- festivals.organization_id NULL means platform-owned: only a platform admin can see or edit such a festival.
-- It also holds everything the later organizer steps need, so the platform uses this one number:
--   festivals.publish_requested_at / publish_review_note   a submit-for-review and an admin's decline note
--   festival_held_schedule_changes   moved, removed and cancelled acts whose alert waits for an admin
--   festival_schedule_alert_runs     one row per moved-set alert a verified organization sent, for its hourly cap
--   organizations.display_name / contact_email   how teammates and emails name the organization
--   organization_member_emails       one row per membership email an owner triggered, for the per-day cap
--   festival_lineup_announce_claims  one row per lineup announcement an organization sent, so the once-a-day guard is atomic
--   organization_uploads             the stored bytes of every site-plan image of an organization's festival
--   festival_announcements.push / organization_id   a banner an unverified organization posts has no push; the daily cap counts by organization
--   a trigger on users that removes a hard-deleted user's id from the held alerts, so retention_cleanup() keeps working
-- Idempotent and additive, no BEGIN/COMMIT, per the repo migration convention.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('venue', 'promoter', 'other')),
  website TEXT CHECK (website IS NULL OR website ~ '^https://'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  verified_at TIMESTAMPTZ,
  display_name TEXT CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 2 AND 80),
  contact_email TEXT CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  -- No FK, like festivals.updated_by (073): a purged user must not block retention.
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- CASCADE so retention can hard-delete a user (089 rule).
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, user_id)
);

-- A member added by email before that person has a confirmed account. There is no token:
-- GET /manage/me claims the row when the signed-in user's confirmed email matches.
CREATE TABLE IF NOT EXISTS organization_pending_members (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email)),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, email)
);

-- A removed organization hands its festivals back to the platform; the app suspends organizations instead.
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS organization_id TEXT REFERENCES organizations (id) ON DELETE SET NULL;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS publish_requested_at TIMESTAMPTZ;
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS publish_review_note TEXT;

-- One row per set (or per announced entry for a cancelled act), merged on every later save: the first
-- before_slot stays, the latest kind, artist and after_slot win, and the people are united. picker_ids and
-- interest_holder_ids hold user ids, so a festival read can never return them by accident.
CREATE TABLE IF NOT EXISTS festival_held_schedule_changes (
  festival_id TEXT NOT NULL REFERENCES festivals (id) ON DELETE CASCADE,
  -- The set id, or the lineup entry id when kind is entry_cancelled.
  set_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('moved', 'removed', 'entry_cancelled')),
  artist TEXT NOT NULL,
  before_slot JSONB,
  after_slot JSONB,
  picker_ids TEXT[] NOT NULL DEFAULT '{}',
  interest_holder_ids TEXT[] NOT NULL DEFAULT '{}',
  -- For entry_cancelled: the stored sets that covered the act, so a person told about a removed set is not told twice.
  covered_set_ids TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (festival_id, set_id)
);

-- A verified organization's save sends its moved-set alert at once, at most ORGANIZER_SCHEDULE_ALERT_HOURLY_CAP
-- runs per festival per hour. A save past the cap is held instead. The cap counts these rows of the last hour.
CREATE TABLE IF NOT EXISTS festival_schedule_alert_runs (
  id BIGSERIAL PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_schedule_alert_runs_festival ON festival_schedule_alert_runs (festival_id, created_at DESC);

-- An organization sends the lineup announcement of a festival once a day. The send claims a row here first, under an
-- advisory lock, so two requests at once cannot both pass and a lost audit row cannot reopen the day.
CREATE TABLE IF NOT EXISTS festival_lineup_announce_claims (
  id BIGSERIAL PRIMARY KEY,
  festival_id TEXT NOT NULL REFERENCES festivals (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lineup_announce_claims_festival ON festival_lineup_announce_claims (festival_id, created_at DESC);

-- The cap counts rows of the last 24 hours, so the app deletes rows older than two days: an address here may belong to
-- someone with no account.
CREATE TABLE IF NOT EXISTS organization_member_emails (
  id BIGSERIAL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_member_emails_org_day ON organization_member_emails (organization_id, created_at DESC);

-- key is the file name stem under public/uploads/siteplans. festival_id has no foreign key: a deleted festival
-- keeps its bytes counted until the orphan sweep removes the file and then the row.
CREATE TABLE IF NOT EXISTS organization_uploads (
  key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  festival_id TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_org_uploads_org ON organization_uploads (organization_id);

-- An organizer's banner goes to every organization; its push only for a verified one (owner decision 3).
-- push is true for every row that exists today, so admin announcements keep pushing. organization_id is set
-- only on an announcement an organization's member sent, and ORGANIZER_ANNOUNCEMENT_DAILY_CAP counts it.
ALTER TABLE festival_announcements ADD COLUMN IF NOT EXISTS push BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE festival_announcements ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- The held alerts keep user ids in arrays, which no foreign key reaches. A trigger on users survives a later
-- redefinition of retention_cleanup(): the hard delete of a user takes that user's id out of every held row.
CREATE OR REPLACE FUNCTION organizer_forget_held_user() RETURNS trigger AS $$
BEGIN
  UPDATE festival_held_schedule_changes
     SET picker_ids = array_remove(picker_ids, OLD.id),
         interest_holder_ids = array_remove(interest_holder_ids, OLD.id)
   WHERE OLD.id = ANY (picker_ids) OR OLD.id = ANY (interest_holder_ids);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organizer_forget_held_user ON users;
CREATE TRIGGER organizer_forget_held_user BEFORE DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION organizer_forget_held_user();
