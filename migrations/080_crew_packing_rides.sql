-- 080_crew_packing_rides.sql
-- Two-way packing and rides. A packed flag for the claimer, ride
-- direction and a real departure time, and a passenger list. Additive only.
ALTER TABLE crew_packing_items ADD COLUMN IF NOT EXISTS packed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE crew_ride_offers ADD COLUMN IF NOT EXISTS direction TEXT
  CHECK (direction IN ('to_festival', 'home'));
ALTER TABLE crew_ride_offers ADD COLUMN IF NOT EXISTS depart_time TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS crew_ride_passengers (
  ride_id TEXT NOT NULL REFERENCES crew_ride_offers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ride_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_crew_ride_passengers_user ON crew_ride_passengers (user_id);
