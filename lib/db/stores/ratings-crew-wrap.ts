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

interface CrewWrapTopSet {
  setId: string;
  artist: string | null;
  rating: number;
}

interface CrewWrapOverlapPair {
  aUserId: string;
  aName: string;
  bUserId: string;
  bName: string;
  /** Count of sets BOTH members rated ≥4★. */
  shared: number;
  /** The shared sets (artist names), capped for display. */
  sharedSets: string[];
}

interface CrewWrapSeenTogether {
  setId: string;
  artist: string | null;
  /** How many members rated this set ≥4★. */
  count: number;
}

interface CrewWrapMemberSummary {
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
