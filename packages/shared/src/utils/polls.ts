import type { CrewMember, CrewPoll } from '../types/domain';

export interface PollTally {
  counts: number[];
  /** User ids per option, in vote order. */
  voters: string[][];
  myIndexes: number[];
  /** Distinct voters. A multi-answer voter counts once. */
  voterCount: number;
  /** Options sharing the top count, when that count is above 0. */
  leaders: number[];
}

export function tallyPoll(poll: Pick<CrewPoll, 'options' | 'votes'>, userId: string | null): PollTally {
  const counts = poll.options.map(() => 0);
  const voters: string[][] = poll.options.map(() => []);
  const myIndexes: number[] = [];
  const everyone = new Set<string>();
  for (const v of poll.votes) {
    if (!v.user_id || !Number.isInteger(v.option) || v.option < 0 || v.option >= poll.options.length) continue;
    counts[v.option]!++;
    voters[v.option]!.push(v.user_id);
    everyone.add(v.user_id);
    if (v.user_id === userId) myIndexes.push(v.option);
  }
  const top = Math.max(0, ...counts);
  const leaders = top > 0 ? counts.flatMap((c, i) => (c === top ? [i] : [])) : [];
  return { counts, voters, myIndexes: myIndexes.sort((a, b) => a - b), voterCount: everyone.size, leaders };
}

export function isPollClosed(poll: Pick<CrewPoll, 'closed' | 'closes_at'>, nowMs: number = Date.now()): boolean {
  if (poll.closed === true) return true;
  const end = poll.closes_at ? Date.parse(poll.closes_at) : NaN;
  return !Number.isNaN(end) && end <= nowMs;
}

export function splitPolls<T extends CrewPoll>(polls: T[], nowMs: number = Date.now()): { open: T[]; decided: T[] } {
  const open: T[] = [];
  const decided: T[] = [];
  for (const p of polls) (isPollClosed(p, nowMs) ? decided : open).push(p);
  const endedAt = (p: T) => Date.parse(p.closed_at ?? p.closes_at ?? p.created_at) || 0;
  decided.sort((a, b) => endedAt(b) - endedAt(a));
  return { open, decided };
}

export function nextVoteIndexes(poll: Pick<CrewPoll, 'multi_answer'>, myIndexes: number[], tapped: number): number[] {
  if (poll.multi_answer) {
    const next = myIndexes.includes(tapped) ? myIndexes.filter((i) => i !== tapped) : [...myIndexes, tapped];
    return next.sort((a, b) => a - b);
  }
  return myIndexes.includes(tapped) ? [] : [tapped];
}

/** With multi-answer the column can add up to more than 100; that is expected. */
export function pollPercent(count: number, voterCount: number): number {
  return voterCount > 0 ? Math.round((count / voterCount) * 100) : 0;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function pollDecision(
  poll: Pick<CrewPoll, 'options'>,
  tally: PollTally,
): { kind: 'winner' | 'tie' | 'none'; text: string; winnerIndex: number | null } {
  if (tally.leaders.length === 0) return { kind: 'none', text: 'No votes', winnerIndex: null };
  if (tally.leaders.length === 1) {
    const i = tally.leaders[0]!;
    return { kind: 'winner', text: `Decided: ${poll.options[i]}`, winnerIndex: i };
  }
  return { kind: 'tie', text: `Tie: ${joinNames(tally.leaders.map((i) => poll.options[i]!))}`, winnerIndex: null };
}

export function decisionSetId(poll: Pick<CrewPoll, 'set_refs'>, decision: { winnerIndex: number | null }): string | null {
  if (decision.winnerIndex === null) return null;
  return poll.set_refs?.[decision.winnerIndex]?.setId ?? null;
}

export type PollEndChoice = 'none' | '30m' | '1h' | 'setStart';

export const POLL_END_CHOICES: readonly { id: PollEndChoice; label: string }[] = [
  { id: 'none', label: 'No end' },
  { id: '30m', label: '30 min' },
  { id: '1h', label: '1 hour' },
  { id: 'setStart', label: 'At set start' },
];

export function pollClosesAt(choice: PollEndChoice, nowMs: number, setStartMs?: number | null): string | undefined {
  if (choice === '30m') return new Date(nowMs + 30 * 60_000).toISOString();
  if (choice === '1h') return new Date(nowMs + 60 * 60_000).toISOString();
  if (choice === 'setStart' && setStartMs != null && setStartMs > nowMs + 60_000) return new Date(setStartMs).toISOString();
  return undefined;
}

export function meetWherePollOptions(input: {
  homeBase?: string | null;
  meetingPoints?: { label: string; active?: boolean }[];
  stages?: { name: string }[];
}): string[] {
  const candidates = [
    input.homeBase,
    ...(input.meetingPoints ?? []).filter((m) => m.active !== false).map((m) => m.label),
    ...(input.stages ?? []).map((s) => s.name),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const text = (raw ?? '').trim().slice(0, 200);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === 4) break;
  }
  return out;
}

export function pollNonVoterIds(poll: Pick<CrewPoll, 'votes'>, memberIds: string[]): string[] {
  const voted = new Set(poll.votes.map((v) => v.user_id).filter((id): id is string => !!id));
  return memberIds.filter((id) => !voted.has(id));
}

export function crewMemberName(m: { name?: string | null; username?: string | null } | undefined): string {
  return m?.name || m?.username || 'Someone';
}

export function voterNamesLine(userIds: string[], members: CrewMember[], max = 3): string {
  if (userIds.length === 0) return '';
  const names = userIds.slice(0, max).map((id) => crewMemberName(members.find((m) => m.userId === id)));
  const extra = userIds.length - names.length;
  return extra > 0 ? `${names.join(', ')} +${extra}` : names.join(', ');
}
