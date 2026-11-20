-- 108_organizations.sql
-- Tenancy core for the organizer platform. An organization owns festivals and has members with a role.
-- festivals.organization_id NULL means platform-owned: only a platform admin can see or edit such a festival.
-- Idempotent and additive, no BEGIN/COMMIT, per the repo migration convention.

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('venue', 'promoter', 'other')),
  website TEXT CHECK (website IS NULL OR website ~ '^https://'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended')),
  verified_at TIMESTAMPTZ,
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
