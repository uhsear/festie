-- 105_profile_interests.sql
-- Interest marks on announced acts, per profile. A JSON map from lineup entry id to a mark:
-- {"state":"open"} or {"state":"converted","sets":[set ids],"at":"ISO time"}. Clients write add and
-- remove deltas, and the server turns open marks into picks when sets cover the act. Nothing here
-- points at festival_sets, like reminders_json.
-- A constant default adds the column without a table rewrite. Old builds ignore it.
ALTER TABLE festival_profiles ADD COLUMN IF NOT EXISTS interests_json JSONB NOT NULL DEFAULT '{}'::jsonb;
