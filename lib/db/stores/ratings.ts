import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Crew wrap — superlative aggregation (M3)
// ---------------------------------------------------------------------------

/** A crew member, as surfaced to the requester (no PII beyond what crew
 *  membership already exposes: id + display name/username). */
export interface CrewWrapMember {
  userId: string;
  name: string;
}

/** One member's high-rated (≥4★) set for a festival. */
export interface CrewHighRating {
  userId: string;
  setId: string;
  artist: string | null;
  rating: number;
}

/** A crew expense row, as returned by expenses.getByCrew (amount is NUMERIC, so often a string). */
export interface CrewWrapExpense {
  amount: number | string;
  paid_by?: string;
  paid_by_name?: string;
  planned?: boolean;
  category?: string | null;
}

export interface CrewWrapTopSet {
  setId: string;
  artist: string | null;
  rating: number;
}

export interface CrewWrapOverlapPair {
  aUserId: string;
  aName: string;
  bUserId: string;
  bName: string;
  /** Count of sets BOTH members rated ≥4★. */
  shared: number;
  /** The shared sets (artist names), capped for display. */
  sharedSets: string[];
}

export interface CrewWrapSeenTogether {
  setId: string;
  artist: string | null;
  /** How many members rated this set ≥4★. */
  count: number;
}

export interface CrewWrapMemberSummary {
  userId: string;
  name: string;
  topSets: CrewWrapTopSet[];
}

export interface CrewWrap {
  crewId: string;
  festivalId: string;
  memberCount: number;
  members: CrewWrapMember[];
  /** The most-overlapping member pair, or null for empty/single-member crews. */
  topOverlap: CrewWrapOverlapPair | null;
  /** All non-zero-overlap pairs, sorted by shared count desc. */
  overlapMatrix: CrewWrapOverlapPair[];
  /** Sets rated ≥4★ by ≥2 members, sorted by count desc. */
  setsSeenTogether: CrewWrapSeenTogether[];
  /** Sum of the crew's spending, in dollars. Planned rows and settle-up payments do not count. */
  totalSplit: number;
  /** The member who paid the most spending (same rows as totalSplit), or null. */
  biggestSpender: { userId: string; name: string; amount: number } | null;
  /** Per-member top-3 high-rated sets. */
  perMember: CrewWrapMemberSummary[];
}

/**
 * Pure superlative math for the crew wrap. Kept DB-free so it can be unit
 * tested directly. All inputs are already scoped to (crewId, festivalId) and
 * to crew members the requester can see — there is no PII here beyond names.
 *
 * Degrades gracefully:
 *   - empty crew  → counts 0, null superlatives, no NaN
 *   - single member → no overlap pairs / no sets-seen-together (needs ≥2)
 */
export function aggregateCrewWrap(
  crewId: string,
  festivalId: string,
  members: CrewWrapMember[],
  highRatings: CrewHighRating[],
  expenses: CrewWrapExpense[],
): CrewWrap {
  const nameOf = new Map(members.map((m) => [m.userId, m.name]));

  // Group high ratings by member and by set.
  const setsByMember = new Map<string, Map<string, CrewHighRating>>();
  const membersBySet = new Map<string, Set<string>>();
  const artistOfSet = new Map<string, string | null>();
  for (const r of highRatings) {
    // Defensive: ignore ratings from non-members (shouldn't happen given the
    // SQL join, but keeps the pure function honest if fed loose data).
    if (!nameOf.has(r.userId)) continue;
    if (!setsByMember.has(r.userId)) setsByMember.set(r.userId, new Map());
    setsByMember.get(r.userId)!.set(r.setId, r);
    if (!membersBySet.has(r.setId)) membersBySet.set(r.setId, new Set());
    membersBySet.get(r.setId)!.add(r.userId);
    if (!artistOfSet.has(r.setId)) artistOfSet.set(r.setId, r.artist ?? null);
  }

  // Pairwise overlap matrix: for each unordered member pair, count the sets
  // both rated ≥4★. O(M²·avgSets) but M is a crew (small, bounded).
  const overlapMatrix: CrewWrapOverlapPair[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const a = members[i]!;
      const b = members[j]!;
      const aSets = setsByMember.get(a.userId);
      const bSets = setsByMember.get(b.userId);
      if (!aSets || !bSets) continue;
      const sharedSets: string[] = [];
      // Iterate the smaller set for efficiency.
      const [small, large] = aSets.size <= bSets.size ? [aSets, bSets] : [bSets, aSets];
      for (const setId of small.keys()) {
        if (large.has(setId)) {
          sharedSets.push(artistOfSet.get(setId) || setId);
        }
      }
      if (sharedSets.length > 0) {
        overlapMatrix.push({
          aUserId: a.userId,
          aName: a.name,
          bUserId: b.userId,
          bName: b.name,
          shared: sharedSets.length,
          sharedSets: sharedSets.slice(0, 5),
        });
      }
    }
  }
  // Stable sort: most overlap first, then by names so output is deterministic.
  overlapMatrix.sort((x, y) => y.shared - x.shared || x.aName.localeCompare(y.aName) || x.bName.localeCompare(y.bName));
  const topOverlap = overlapMatrix[0] ?? null;

  // Sets seen together: rated ≥4★ by ≥2 members.
  const setsSeenTogether: CrewWrapSeenTogether[] = [];
  for (const [setId, memberSet] of membersBySet) {
    if (memberSet.size >= 2) {
      setsSeenTogether.push({
        setId,
        artist: artistOfSet.get(setId) ?? null,
        count: memberSet.size,
      });
    }
  }
  setsSeenTogether.sort((x, y) => y.count - x.count || (x.artist || x.setId).localeCompare(y.artist || y.setId));

  // Spending only: planned (forecast) rows and settle-up payments are not
  // money the crew spent. Balances are not used, because settling up zeroes them.
  // NUMERIC arrives as a string from pg, so coerce with Number; sum in cents to
  // avoid float drift.
  let totalSplitCents = 0;
  const paidCents = new Map<string, number>();
  // A payer who left the crew is not in the roster, so keep the row's username.
  const paidByName = new Map<string, string>();
  for (const e of expenses) {
    if (e.planned || e.category === 'settlement') continue;
    const cents = Math.round(Number(e.amount) * 100);
    if (!Number.isFinite(cents)) continue;
    totalSplitCents += cents;
    if (!e.paid_by) continue;
    paidCents.set(e.paid_by, (paidCents.get(e.paid_by) ?? 0) + cents);
    if (e.paid_by_name && !paidByName.has(e.paid_by)) paidByName.set(e.paid_by, e.paid_by_name);
  }
  const totalSplit = totalSplitCents / 100;

  // Biggest spender: the member who paid the most. A tie goes to the name that
  // sorts first, so the result is stable.
  let biggestSpender: CrewWrap['biggestSpender'] = null;
  let bestCents = 0;
  for (const [userId, cents] of paidCents) {
    const name = nameOf.get(userId) ?? paidByName.get(userId) ?? 'A crewmate';
    if (cents > bestCents || (biggestSpender && cents === bestCents && name.localeCompare(biggestSpender.name) < 0)) {
      bestCents = cents;
      biggestSpender = { userId, name, amount: cents / 100 };
    }
  }

  // Per-member top-3 high-rated sets (rating desc, then artist for stability).
  const perMember: CrewWrapMemberSummary[] = members.map((m) => {
    const sets = Array.from(setsByMember.get(m.userId)?.values() ?? [])
      .sort((x, y) => y.rating - x.rating || (x.artist || x.setId).localeCompare(y.artist || y.setId))
      .slice(0, 3)
      .map((r) => ({ setId: r.setId, artist: r.artist ?? null, rating: r.rating }));
    return { userId: m.userId, name: m.name, topSets: sets };
  });

  return {
    crewId,
    festivalId,
    memberCount: members.length,
    members,
    topOverlap,
    overlapMatrix,
    setsSeenTogether,
    totalSplit,
    biggestSpender,
    perMember,
  };
}

// Hours of one set (alias s). Wraps past midnight, so 23:00 to 01:00 is 2, not -22.
// getWrapStats and getLifetimeStats both use it so their totals agree.
const SET_HOURS_EXPR = `
  CASE WHEN s.start_time IS NOT NULL AND s.end_time IS NOT NULL
  THEN MOD((EXTRACT(EPOCH FROM (s.end_time::time - s.start_time::time)) / 3600.0 + 24)::numeric, 24)
  ELSE 0 END`;

export function createRatingsStore(pool: Pool) {
  return {
    /** A null note keeps the stored note; '' clears it. A first rating stores ''. */
    async upsert(userId: string, setId: string, rating: number, note: string | null = null) {
      const result = await pool.query(
        `
        INSERT INTO set_ratings (user_id, set_id, rating, note, updated_at)
        VALUES ($1, $2, $3, COALESCE($4, ''), NOW())
        ON CONFLICT (user_id, set_id) DO UPDATE SET
          rating = EXCLUDED.rating,
          note = CASE WHEN $4::text IS NULL THEN set_ratings.note ELSE EXCLUDED.note END,
          updated_at = NOW()
        RETURNING id, user_id AS "userId", set_id AS "setId", rating, note, created_at AS "createdAt", updated_at AS "updatedAt"
      `,
        [userId, setId, rating, note],
      );
      return result.rows[0];
    },

    async getByUser(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          r.id,
          r.set_id AS "setId",
          r.rating,
          r.note,
          r.created_at AS "createdAt",
          r.updated_at AS "updatedAt",
          s.artist,
          s.stage_id AS "stageId",
          st.name AS "stageName",
          s.start_time AS "startTime",
          s.end_time AS "endTime",
          s.day_index AS "dayIndex"
        FROM
          set_ratings r
          JOIN festival_sets s ON s.id = r.set_id
          LEFT JOIN festival_stages st ON st.festival_id = s.festival_id
          AND st.id = s.stage_id
        WHERE
          r.user_id = $1
          AND s.festival_id = $2
        ORDER BY
          r.rating DESC,
          s.day_index,
          s.start_time
      `,
        [userId, festivalId],
      );
      return result.rows;
    },

    async getByFestival(festivalId: string, { cursor, limit = 50 }: any = {}) {
      const params: any[] = [festivalId, limit + 1];
      let having = '';
      if (cursor) {
        having = 'HAVING r.set_id > $3';
        params.push(cursor);
      }
      const result = await pool.query(
        `
        SELECT r.set_id AS "setId",
               COUNT(*)::int AS "totalRatings",
               ROUND(AVG(r.rating), 1)::float AS "avgRating"
        FROM set_ratings r
        JOIN festival_sets s ON s.id = r.set_id
        WHERE s.festival_id = $1
        GROUP BY r.set_id
        ${having}
        ORDER BY r.set_id ASC
        LIMIT $2
      `,
        params,
      );
      const hasMore = result.rows.length > limit;
      if (hasMore) result.rows.pop();
      return {
        items: result.rows,
        nextCursor: hasMore ? result.rows[result.rows.length - 1].setId : null,
      };
    },

    async getCrewRatings(crewId: string, festivalId: string, { cursor, limit = 50 }: any = {}) {
      const params: any[] = [crewId, festivalId, limit + 1];
      let cursorClause = '';
      if (cursor) {
        cursorClause = 'AND r.id > $4';
        params.push(cursor);
      }
      const result = await pool.query(
        `
        SELECT r.id, r.set_id AS "setId", r.user_id AS "userId", r.rating, r.note,
               u.username, s.artist
        FROM set_ratings r
        JOIN festival_sets s ON s.id = r.set_id
        JOIN crew_members cm ON cm.user_id = r.user_id AND cm.crew_id = $1
        JOIN users u ON u.id = r.user_id AND u.deleted_at IS NULL
        WHERE s.festival_id = $2
        ${cursorClause}
        ORDER BY r.id ASC
        LIMIT $3
      `,
        params,
      );
      const hasMore = result.rows.length > limit;
      if (hasMore) result.rows.pop();
      return {
        items: result.rows,
        nextCursor: hasMore ? result.rows[result.rows.length - 1].id : null,
      };
    },

    /**
     * Crew-aware wrap superlatives (M3). Read-model only — no migration.
     *
     * Aggregates in SQL where practical:
     *   - crew roster (id + display name) in one query
     *   - every member's ≥4★ rating for this festival in one query (NOT paged
     *     in JS — the pairwise overlap needs the full high-rated set, which is
     *     bounded by crew-size × sets-rated and small in practice)
     * then folds the superlative math (overlap matrix, sets-seen-together,
     * per-member top-3) in `aggregateCrewWrap`.
     *
     * Expense aggregates (totalSplit / biggestSpender) come from the expense
     * rows the caller passes (the route passes expenses.getByCrew). Only
     * spending counts: planned rows and settle-up payments are skipped. The
     * list defaults to empty so the wrap degrades gracefully with no expenses.
     *
     * Only returns data about crew members the requester can already see — the
     * route gates on crews.getMember before calling this, and we never expose
     * anything beyond names + this festival's high ratings.
     */
    async getCrewWrap(
      crewId: string,
      festivalId: string,
      {
        expenses = [],
      }: {
        expenses?: CrewWrapExpense[];
      } = {},
    ): Promise<CrewWrap> {
      const [memberRes, ratingRes] = await Promise.all([
        // Roster: prefer display name, fall back to username. deleted users
        // are excluded so a removed account doesn't leak a stale row.
        pool.query(
          `
          SELECT
            cm.user_id AS "userId",
            COALESCE(NULLIF(u.display_name, ''), u.username) AS "name"
          FROM
            crew_members cm
            JOIN users u ON u.id = cm.user_id
            AND u.deleted_at IS NULL
          WHERE
            cm.crew_id = $1
          ORDER BY
            "name" ASC
        `,
          [crewId],
        ),
        // Every crew member's ≥4★ rating for this festival, scoped via the
        // crew_members join so non-members can never appear.
        pool.query(
          `
          SELECT
            r.user_id AS "userId",
            r.set_id AS "setId",
            s.artist,
            r.rating
          FROM
            set_ratings r
            JOIN festival_sets s ON s.id = r.set_id
            JOIN crew_members cm ON cm.user_id = r.user_id
            AND cm.crew_id = $1
            JOIN users u ON u.id = r.user_id
            AND u.deleted_at IS NULL
          WHERE
            s.festival_id = $2
            AND r.rating >= 4
        `,
          [crewId, festivalId],
        ),
      ]);

      return aggregateCrewWrap(
        crewId,
        festivalId,
        memberRes.rows as CrewWrapMember[],
        ratingRes.rows as CrewHighRating[],
        expenses,
      );
    },

    async delete(userId: string, setId: string) {
      await pool.query('DELETE FROM set_ratings WHERE user_id = $1 AND set_id = $2', [userId, setId]);
    },

    /**
     * Cross-festival year-over-year history (M3). Un-festival-scoped: drops the
     * `s.festival_id = $2` filter that getWrapStats / getByUser apply, so it
     * scans every set the user has ever rated (kept fast by the
     * `set_ratings(user_id)` index added in migration 044).
     *
     * Returns four slices:
     *   - totals: lifetime aggregates across ALL festivals (same per-row math
     *     as getWrapStats so lifetime totals = sum of per-festival stats and
     *     there's no TZ drift — the hours math reuses SET_HOURS_EXPR).
     *   - byFestival: one row per festival (a per-year breakdown), newest first,
     *     carrying the festival name + its date span (MIN/MAX of festival_days,
     *     which is the only date source — `festivals` has no start/end columns).
     *   - topArtists: the user's highest-loved artists across every festival.
     *   - seenMost: artists the user saw at 2 or more festivals, max 10,
     *     festivals desc then artist asc. A set counts as seen when it is marked
     *     caught = true, or rated and not marked caught = false; a pick alone
     *     never counts. Each named element of festival_sets.artists counts
     *     (B2B), else festival_sets.artist. Names group case-insensitively after
     *     trimming and show MIN(name); a festival counts once per artist.
     *
     * Soft-deleted festivals and users are excluded (deleted_at IS NULL),
     * matching the filters sibling queries (getCrewWrap roster, the rate-set
     * existence check) apply. Empty input (zero ratings) yields clean zeroed
     * totals + empty arrays — never a 500.
     */
    async getLifetimeStats(userId: string) {
      // Reused hours expression — identical to getWrapStats so per-festival
      // numbers sum to the lifetime total with no timezone drift.
      const HOURS_EXPR = `SUM(${SET_HOURS_EXPR})::float`;

      const [totalsRes, byFestivalRes, topArtistsRes, seenMostRes] = await Promise.all([
        // Lifetime totals across every (non-deleted) festival the user rated in.
        pool.query(
          `
          SELECT
            COUNT(*)::int AS "totalRated",
            ROUND(AVG(r.rating), 1)::float AS "avgRating",
            COUNT(DISTINCT s.festival_id)::int AS "festivalsAttended",
            COUNT(DISTINCT s.stage_id)::int AS "stagesVisited",
            COUNT(DISTINCT s.day_index)::int AS "daysAttended",
            ${HOURS_EXPR} AS "totalHours"
          FROM set_ratings r
          JOIN festival_sets s ON s.id = r.set_id
          JOIN festivals f ON f.id = s.festival_id AND f.deleted_at IS NULL
          WHERE r.user_id = $1
        `,
          [userId],
        ),
        // Per-festival (per-year) breakdown, newest span first. Dates come from
        // festival_days (the only date source); a festival with no days sorts
        // last via NULLS LAST.
        pool.query(
          `
          SELECT
            f.id AS "festivalId",
            f.name AS "festivalName",
            (SELECT MIN(d.date) FROM festival_days d WHERE d.festival_id = f.id) AS "startDate",
            (SELECT MAX(d.date) FROM festival_days d WHERE d.festival_id = f.id) AS "endDate",
            COUNT(*)::int AS "totalRated",
            ROUND(AVG(r.rating), 1)::float AS "avgRating",
            COUNT(DISTINCT s.stage_id)::int AS "stagesVisited",
            COUNT(DISTINCT s.day_index)::int AS "daysAttended",
            ${HOURS_EXPR} AS "totalHours"
          FROM set_ratings r
          JOIN festival_sets s ON s.id = r.set_id
          JOIN festivals f ON f.id = s.festival_id AND f.deleted_at IS NULL
          WHERE r.user_id = $1
          GROUP BY f.id, f.name
          ORDER BY "startDate" DESC NULLS LAST, f.name ASC
        `,
          [userId],
        ),
        // Top artists across ALL festivals — by best rating, then how many times
        // loved. Capped for display.
        pool.query(
          `
          SELECT
            s.artist AS "artist",
            COUNT(*)::int AS "timesRated",
            MAX(r.rating)::int AS "bestRating",
            ROUND(AVG(r.rating), 1)::float AS "avgRating"
          FROM set_ratings r
          JOIN festival_sets s ON s.id = r.set_id
          JOIN festivals f ON f.id = s.festival_id AND f.deleted_at IS NULL
          WHERE r.user_id = $1 AND s.artist IS NOT NULL AND s.artist <> ''
          GROUP BY s.artist
          ORDER BY "bestRating" DESC, "timesRated" DESC, s.artist ASC
          LIMIT 10
        `,
          [userId],
        ),
        // Artists seen at 2+ festivals. jsonb_typeof guards a null or scalar
        // `artists`: jsonb_array_length raises on a scalar and OR does not
        // short-circuit. array_agg over zero names is NULL, so COALESCE falls
        // back to the headline artist.
        pool.query(
          `
          WITH seen AS (
            SELECT c.set_id FROM set_caught c WHERE c.user_id = $1 AND c.caught
            UNION
            SELECT r.set_id FROM set_ratings r
            WHERE r.user_id = $1
              AND NOT EXISTS (SELECT 1 FROM set_caught c2 WHERE c2.user_id = $1 AND c2.set_id = r.set_id AND NOT c2.caught)
          ),
          names AS (
            SELECT s.festival_id, btrim(n.name) AS name
            FROM seen
            JOIN festival_sets s ON s.id = seen.set_id
            JOIN festivals f ON f.id = s.festival_id AND f.deleted_at IS NULL
            CROSS JOIN LATERAL (
              SELECT COALESCE(
                (SELECT array_agg(e->>'name')
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.artists) = 'array' THEN s.artists ELSE '[]'::jsonb END) e
                  WHERE jsonb_typeof(e) = 'object' AND btrim(COALESCE(e->>'name', '')) <> ''),
                ARRAY[s.artist]
              ) AS list
            ) a
            CROSS JOIN LATERAL unnest(a.list) AS n(name)
            WHERE n.name IS NOT NULL AND btrim(n.name) <> ''
          )
          SELECT MIN(name) AS "artist", COUNT(DISTINCT festival_id)::int AS "festivals"
          FROM names
          GROUP BY lower(name)
          HAVING COUNT(DISTINCT festival_id) >= 2
          ORDER BY "festivals" DESC, MIN(name) ASC
          LIMIT 10
        `,
          [userId],
        ),
      ]);

      const totals = totalsRes.rows[0] || {};
      return {
        totals: {
          totalRated: totals.totalRated ?? 0,
          avgRating: totals.avgRating ?? 0,
          festivalsAttended: totals.festivalsAttended ?? 0,
          stagesVisited: totals.stagesVisited ?? 0,
          daysAttended: totals.daysAttended ?? 0,
          totalHours: totals.totalHours ?? 0,
        },
        byFestival: byFestivalRes.rows,
        topArtists: topArtistsRes.rows,
        seenMost: seenMostRes.rows,
      };
    },

    /**
     * Distinct festivals the user has a footprint in — either a rating or a
     * festival profile — newest first. Used by the History surface to list
     * everywhere the user has been, even festivals where they rated nothing.
     * Soft-deleted festivals/profiles are excluded.
     */
    async getAttendedFestivals(userId: string) {
      const result = await pool.query(
        `
        SELECT
          f.id AS "festivalId",
          f.name AS "festivalName",
          (SELECT MIN(d.date) FROM festival_days d WHERE d.festival_id = f.id) AS "startDate",
          (SELECT MAX(d.date) FROM festival_days d WHERE d.festival_id = f.id) AS "endDate"
        FROM festivals f
        WHERE f.deleted_at IS NULL
          AND (
            EXISTS (
              SELECT 1
              FROM set_ratings r
              JOIN festival_sets s ON s.id = r.set_id
              WHERE r.user_id = $1 AND s.festival_id = f.id
            )
            OR EXISTS (
              SELECT 1
              FROM festival_profiles p
              WHERE p.user_id = $1 AND p.festival_id = f.id AND p.deleted_at IS NULL
            )
          )
        ORDER BY "startDate" DESC NULLS LAST, f.name ASC
      `,
        [userId],
      );
      return result.rows;
    },

    /**
     * Hours and stages count the sets marked caught = true once the user has
     * any caught row for this festival. Otherwise they count rated sets, so
     * festivals from before caught marks existed keep their numbers.
     */
    async getWrapStats(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        WITH rated AS (
          SELECT r.rating, s.stage_id, s.day_index, ${SET_HOURS_EXPR} AS hours
          FROM set_ratings r
          JOIN festival_sets s ON s.id = r.set_id
          WHERE r.user_id = $1 AND s.festival_id = $2
        ),
        marks AS (
          SELECT c.caught, s.stage_id, ${SET_HOURS_EXPR} AS hours
          FROM set_caught c
          JOIN festival_sets s ON s.id = c.set_id
          WHERE c.user_id = $1 AND s.festival_id = $2
        ),
        counted AS (
          SELECT stage_id, hours FROM marks WHERE caught
          UNION ALL
          SELECT stage_id, hours FROM rated WHERE NOT EXISTS (SELECT 1 FROM marks)
        )
        SELECT
          (SELECT COUNT(*)::int FROM rated) AS "totalRated",
          (SELECT ROUND(AVG(rating), 1)::float FROM rated) AS "avgRating",
          (SELECT COUNT(DISTINCT stage_id)::int FROM counted) AS "stagesVisited",
          (SELECT COUNT(DISTINCT day_index)::int FROM rated) AS "daysAttended",
          (SELECT COALESCE(SUM(hours), 0)::float FROM counted) AS "totalHours"
      `,
        [userId, festivalId],
      );
      return result.rows[0] || { totalRated: 0, avgRating: 0, stagesVisited: 0, daysAttended: 0, totalHours: 0 };
    },

    /** caught null deletes the mark (back to unknown). */
    async setCaught(userId: string, setId: string, caught: boolean | null) {
      if (caught === null) {
        await pool.query('DELETE FROM set_caught WHERE user_id = $1 AND set_id = $2', [userId, setId]);
        return { setId, caught: null };
      }
      const result = await pool.query(
        `
        INSERT INTO set_caught (user_id, set_id, caught, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (user_id, set_id) DO UPDATE SET caught = EXCLUDED.caught, updated_at = NOW()
        RETURNING set_id AS "setId", caught
      `,
        [userId, setId, caught],
      );
      return result.rows[0];
    },

    /**
     * Every set the user picked in this festival, with their rating and caught
     * mark. crewAlso counts the other non-deleted members of crewId who picked
     * the same set; it is null when crewId is null. No other member's name or
     * id leaves this query.
     */
    async getPlannedForWrap(userId: string, festivalId: string, crewId: string | null) {
      const result = await pool.query(
        `
        SELECT
          s.id AS "setId",
          s.artist,
          s.stage_id AS "stageId",
          st.name AS "stageName",
          s.day_index AS "dayIndex",
          s.start_time AS "startTime",
          s.end_time AS "endTime",
          pp.priority,
          r.rating,
          r.note,
          c.caught,
          CASE WHEN $3::text IS NULL THEN NULL ELSE (
            SELECT COUNT(DISTINCT p2.user_id)::int
            FROM festival_profile_picks pp2
            JOIN festival_profiles p2 ON p2.id = pp2.profile_id
              AND p2.deleted_at IS NULL
              AND p2.festival_id = $2
            JOIN crew_members cm ON cm.user_id = p2.user_id AND cm.crew_id = $3
            JOIN users u ON u.id = p2.user_id AND u.deleted_at IS NULL
            WHERE pp2.set_id = s.id AND p2.user_id <> $1
          ) END AS "crewAlso"
        FROM festival_profiles p
        JOIN festival_profile_picks pp ON pp.profile_id = p.id
        JOIN festival_sets s ON s.id = pp.set_id AND s.festival_id = $2
        LEFT JOIN festival_stages st ON st.festival_id = s.festival_id AND st.id = s.stage_id
        LEFT JOIN set_ratings r ON r.user_id = $1 AND r.set_id = s.id
        LEFT JOIN set_caught c ON c.user_id = $1 AND c.set_id = s.id
        WHERE p.user_id = $1 AND p.festival_id = $2 AND p.deleted_at IS NULL
        ORDER BY s.day_index NULLS LAST, s.start_time NULLS LAST
      `,
        [userId, festivalId, crewId],
      );
      return result.rows;
    },

    /**
     * Sets in this festival that the requester marked caught = true and did
     * not pick, with their own rating. Returns only the requester's own marks.
     * The NOT EXISTS mirrors getPlannedForWrap's join, so a set is in one list.
     */
    async getCaughtExtraForWrap(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT s.id AS "setId", s.artist, s.stage_id AS "stageId", st.name AS "stageName",
               s.day_index AS "dayIndex", s.start_time AS "startTime", s.end_time AS "endTime",
               r.rating, r.note, c.caught
        FROM set_caught c
        JOIN festival_sets s ON s.id = c.set_id AND s.festival_id = $2
        LEFT JOIN festival_stages st ON st.festival_id = s.festival_id AND st.id = s.stage_id
        LEFT JOIN set_ratings r ON r.user_id = $1 AND r.set_id = s.id
        WHERE c.user_id = $1 AND c.caught
          AND NOT EXISTS (
            SELECT 1 FROM festival_profiles p
            JOIN festival_profile_picks pp ON pp.profile_id = p.id
            WHERE p.user_id = $1 AND p.festival_id = $2 AND p.deleted_at IS NULL AND pp.set_id = s.id
          )
        ORDER BY s.day_index NULLS LAST, s.start_time NULLS LAST
      `,
        [userId, festivalId],
      );
      return result.rows;
    },

    /** Festival name, zone and days ordered by day_index, or null when missing or deleted. */
    async getWrapFestival(festivalId: string) {
      const [festivalRes, daysRes] = await Promise.all([
        pool.query('SELECT id, name, time_zone FROM festivals WHERE id = $1 AND deleted_at IS NULL', [festivalId]),
        pool.query('SELECT label, date FROM festival_days WHERE festival_id = $1 ORDER BY day_index', [festivalId]),
      ]);
      const festival = festivalRes.rows[0];
      if (!festival) return null;
      return {
        id: festival.id,
        name: festival.name,
        timeZone: festival.time_zone ?? null,
        days: daysRes.rows.map((d: { label: string | null; date: string | null }) => ({
          date: d.date,
          label: d.label ?? null,
        })),
      };
    },
  };
}
