export interface CrewBadgeSeen {
  pollIds: string[];
  balanceCents: number | null;
}

type BadgePoll = {
  id: string;
  closed?: boolean | null;
  votes?: ReadonlyArray<{ user_id?: string | null } | null> | null;
};

export function openPollIds(polls: ReadonlyArray<BadgePoll>): string[] {
  return polls.filter((p) => !p.closed).map((p) => p.id);
}

export function balanceCents(myBalance: number | null | undefined): number {
  return myBalance == null ? 0 : Math.round(myBalance * 100);
}

export function crewTabBadge(input: {
  polls: ReadonlyArray<BadgePoll>;
  myBalance: number | null | undefined;
  userId: string | null | undefined;
  seen: CrewBadgeSeen | undefined;
}): { count: number; dot: boolean; label: string | null } {
  const { polls, myBalance, userId, seen } = input;
  if (!userId) return { count: 0, dot: false, label: null };
  const seenIds = new Set(seen?.pollIds ?? []);
  // The polls query can return { user_id: null } for a poll with no votes; v?. skips those.
  const count = polls.filter(
    (p) => !p.closed && !seenIds.has(p.id) && !(p.votes ?? []).some((v) => v?.user_id === userId),
  ).length;
  const cents = balanceCents(myBalance);
  const dot = count === 0 && cents !== 0 && cents !== seen?.balanceCents;
  const label = count > 9 ? '9+' : count > 0 ? String(count) : dot ? '' : null;
  return { count, dot, label };
}

export function badgeA11yLabel(tabLabel: string, badge: { count: number; dot: boolean }): string {
  if (badge.count > 0) return `${tabLabel}, ${badge.count} new`;
  if (badge.dot) return `${tabLabel}, needs attention`;
  return tabLabel;
}
