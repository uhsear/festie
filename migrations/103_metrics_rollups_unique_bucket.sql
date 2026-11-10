-- 103_metrics_rollups_unique_bucket.sql
-- metrics-rollup.js inserts once per hour, but a re-run in the same hour added a duplicate row
-- because nothing enforced one row per bucket. Keep the newest row per bucket, then enforce it.
DELETE FROM metrics_rollups a
USING metrics_rollups b
WHERE a.bucket_start = b.bucket_start
  AND a.id < b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_metrics_rollups_bucket_start ON metrics_rollups (bucket_start);
