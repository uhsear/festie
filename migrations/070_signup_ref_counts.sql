-- 070_signup_ref_counts.sql
-- Anonymous sign-up counts per ?ref= source, one row per day and ref.
-- Holds no user id, no IP and nothing else that identifies a person.
CREATE TABLE IF NOT EXISTS signup_ref_counts (
  day DATE NOT NULL,
  ref TEXT NOT NULL,
  signups INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ref)
);
