-- 073_festival_publish.sql
-- Draft/publish for festivals (admin-37). published_at IS NULL means draft:
-- only admins can see it. DEFAULT NOW() fills every existing row, so every
-- current festival stays published. Only POST /admin/festivals inserts NULL.
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ DEFAULT NOW();
-- Last admin who saved, published or restored the festival (editor status chip).
-- No foreign key: deleting that admin must not block or cascade.
ALTER TABLE festivals ADD COLUMN IF NOT EXISTS updated_by TEXT;
