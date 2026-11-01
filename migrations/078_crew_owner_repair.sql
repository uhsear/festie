-- 078_crew_owner_repair.sql
-- Data repair for crew ownership. No schema change.
--
-- Two kinds of bad rows exist in production data:
--
-- 1. Stale crews.created_by. PUT /crews/:id/transfer swapped crew_members.role
--    but never moved crews.created_by. The API sends created_by as `owner`, so
--    the old owner kept owner controls that the server then refused. The heir
--    logic in users.hardDelete and retention_cleanup() (migration 060) also
--    reads created_by. lib/db/stores/crews.ts transferOwnership now moves it in
--    the same transaction. This repairs the rows written before that fix.
--
-- 2. Ownerless crews. DELETE /account soft-deleted an owner without handing the
--    crew over, and getMembers hides deleted users, so the crew had no visible
--    owner for the 30-day grace period. DELETE /account now hands crews over
--    first. This gives each affected crew an owner: the earliest-joined active
--    member. A crew with no active member is left alone; the purge handles it.
--
-- Both statements skip a crew whose new created_by would clash with another
-- crew on crews_reform_idem_uidx (created_by, festival_id, reformed_from), so
-- the migration cannot abort boot on a unique violation.
--
-- Idempotent: each statement matches only rows that are still wrong, so a second
-- run changes nothing. Additive, forward-only. Runs in the runner's single
-- transaction (no CONCURRENTLY).

-- ── 1. Sync created_by with the one active owner row ──
WITH active_owner AS (
  SELECT cm.crew_id, MIN(cm.user_id) AS user_id
  FROM crew_members cm
  JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
  WHERE cm.role = 'owner'
  GROUP BY cm.crew_id
  HAVING COUNT(*) = 1
),
target AS (
  SELECT
    c.id,
    ao.user_id,
    ROW_NUMBER() OVER (
      PARTITION BY ao.user_id, c.festival_id, c.reformed_from
      ORDER BY c.created_at ASC, c.id ASC
    ) AS rn
  FROM crews c
  JOIN active_owner ao ON ao.crew_id = c.id
  WHERE c.created_by IS DISTINCT FROM ao.user_id
)
UPDATE crews c
SET created_by = t.user_id, updated_at = NOW()
FROM target t
WHERE c.id = t.id
  AND (
    c.reformed_from IS NULL
    OR (
      t.rn = 1
      AND NOT EXISTS (
        SELECT 1 FROM crews o
        WHERE o.created_by = t.user_id
          AND o.festival_id = c.festival_id
          AND o.reformed_from = c.reformed_from
      )
    )
  );

-- ── 2. Give ownerless crews an owner ──
-- demoted and promoted touch different rows: demoted only deleted users,
-- promoted only the active heir.
WITH ownerless AS (
  SELECT c.id
  FROM crews c
  WHERE NOT EXISTS (
    SELECT 1 FROM crew_members o
    JOIN users ou ON ou.id = o.user_id AND ou.deleted_at IS NULL
    WHERE o.crew_id = c.id AND o.role = 'owner'
  )
),
heir AS (
  SELECT DISTINCT ON (cm.crew_id) cm.crew_id, cm.user_id
  FROM crew_members cm
  JOIN users u ON u.id = cm.user_id AND u.deleted_at IS NULL
  WHERE cm.crew_id IN (SELECT id FROM ownerless)
  ORDER BY cm.crew_id, cm.joined_at ASC, cm.user_id ASC
),
demoted AS (
  UPDATE crew_members cm
  SET role = 'member'
  FROM heir h, users u
  WHERE cm.crew_id = h.crew_id
    AND cm.role = 'owner'
    AND u.id = cm.user_id
    AND u.deleted_at IS NOT NULL
  RETURNING cm.crew_id
),
promoted AS (
  UPDATE crew_members cm
  SET role = 'owner'
  FROM heir h
  WHERE cm.crew_id = h.crew_id AND cm.user_id = h.user_id
  RETURNING cm.crew_id
)
UPDATE crews c
SET created_by = h.user_id, updated_at = NOW()
FROM heir h
WHERE c.id = h.crew_id
  AND c.created_by IS DISTINCT FROM h.user_id
  AND (
    c.reformed_from IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM crews o
      WHERE o.created_by = h.user_id
        AND o.festival_id = c.festival_id
        AND o.reformed_from = c.reformed_from
    )
  );
