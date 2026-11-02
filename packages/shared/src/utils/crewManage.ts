import { MAX_CREWS_PER_FESTIVAL, MAX_OPEN_POLLS_PER_CREW } from '../constants/config';
import type { Crew, CrewMember, Festival } from '../types/domain';
import { festivalStatus, type FestivalStatus } from './festivalTime';

// Shared crew-management logic and copy. Web and mobile both render these
// strings and decisions, so they stay in one place.

/** Strings both apps show for crew management. */
export const crewCopy = {
  joined: (crew: string) => `You joined ${crew}`,
  removed: (name: string) => `Removed ${name}`,
  transferred: (name: string) => `${name} now owns the crew`,
  inviteRegenerated: 'New invite code ready',
  renamed: 'Crew renamed',
  added: (username: string) => `Added ${username}`,
  noUserCalled: (q: string) => `No user called "${q}". Check the spelling.`,
  handOverTitle: (crew: string) => `Who should own ${crew}?`,
  handOverBody: 'Pick a new owner. Then you leave the crew.',
  handOverConfirm: 'Hand over and leave',
  handedOverAndLeft: (crew: string, name: string) => `You left ${crew}. ${name} owns it now.`,
  handOverPartial: (crew: string, name: string) =>
    `${name} now owns ${crew}, but leaving failed. Tap Leave crew to try again.`,
  createFor: (label: string) => `For ${label}`,
  pickFestivalFirst: 'Pick a festival first. A crew belongs to one festival.',
  createHelper: 'You can invite friends next.',
  inviteCardTitle: 'Invite your crew',
  inviteCardBody: (crew: string) => `${crew} is just you so far. Share the link and friends join in one tap.`,
  addTotem: 'Add a crew totem',
  totemExplainer: 'A crew totem is the flag or sign you hold up so friends can spot you in the crowd.',
  pollCap: `Close a poll to start another. A crew can have ${MAX_OPEN_POLLS_PER_CREW} open polls.`,
  deleteOwnedTitle: 'Crews you own',
  deleteOwnedBody: 'Choose who takes over each crew. If you skip this, the member who joined first takes over.',
  newOwnerFor: (crew: string) => `New owner for ${crew}`,
  deleteSolo: (n: number) =>
    n === 1
      ? "You're the only member of 1 crew. It is deleted with your account after 30 days."
      : `You're the only member of ${n} crews. They are deleted with your account after 30 days.`,
};

/** Adds the start year to a festival name that has none, so two years of one festival differ. */
export function festivalLabel(f: Pick<Festival, 'name' | 'startDate'>): string {
  if (/\b(19|20)\d{2}\b/.test(f.name)) return f.name;
  if (/^\d{4}/.test(f.startDate ?? '')) return `${f.name} ${f.startDate.slice(0, 4)}`;
  return f.name;
}

export interface CrewFestivalGroup {
  festivalId: string | null;
  /** Null for crews whose festival is not loaded. */
  label: string | null;
  /** 'past' groups render dimmed. */
  status: FestivalStatus | null;
  isCurrent: boolean;
  crews: Crew[];
}

const byStart = (a: Festival, b: Festival) => (a.startDate ?? '').localeCompare(b.startDate ?? '');

export function groupCrewsByFestival(
  crews: Crew[],
  festivals: Festival[],
  currentFestivalId: string | null | undefined,
  now: Date = new Date(),
): CrewFestivalGroup[] {
  const known = new Map(festivals.map((f) => [f.id, f]));
  const buckets = new Map<string, Crew[]>();
  const unknown: Crew[] = [];
  for (const crew of crews) {
    if (crew.festivalId && known.has(crew.festivalId)) {
      const list = buckets.get(crew.festivalId) ?? [];
      list.push(crew);
      buckets.set(crew.festivalId, list);
    } else {
      unknown.push(crew);
    }
  }
  const groups = [...buckets].map(([id, list]): CrewFestivalGroup => {
    const festival = known.get(id)!;
    return {
      festivalId: id,
      label: festivalLabel(festival),
      status: festivalStatus(festival, null, now),
      isCurrent: id === currentFestivalId,
      crews: list,
    };
  });
  const festivalOf = (g: CrewFestivalGroup) => known.get(g.festivalId!)!;
  const current = groups.filter((g) => g.isCurrent);
  const upcoming = groups
    .filter((g) => !g.isCurrent && g.status !== 'past')
    .sort((a, b) => byStart(festivalOf(a), festivalOf(b)));
  const past = groups
    .filter((g) => !g.isCurrent && g.status === 'past')
    .sort((a, b) => byStart(festivalOf(b), festivalOf(a)));
  const ordered = [...current, ...upcoming, ...past];
  if (unknown.length) {
    ordered.push({ festivalId: null, label: null, status: null, isCurrent: false, crews: unknown });
  }
  return ordered;
}

/** Festivals a new crew can belong to: not past, plus the current one. Current first. */
export function crewFestivalChoices(
  festivals: Festival[],
  currentFestivalId: string | null | undefined,
  now: Date = new Date(),
): Festival[] {
  return festivals
    .filter((f) => f.id === currentFestivalId || festivalStatus(f, null, now) !== 'past')
    .sort((a, b) => {
      if (a.id === currentFestivalId) return -1;
      if (b.id === currentFestivalId) return 1;
      return byStart(a, b);
    });
}

export function crewCapState(
  crews: Crew[],
  festivalId: string | null | undefined,
): { count: number; max: number; atCap: boolean; text: string | null } {
  const max = MAX_CREWS_PER_FESTIVAL;
  const count = festivalId ? crews.filter((c) => !c._optimistic && c.festivalId === festivalId).length : 0;
  const atCap = count >= max;
  if (!festivalId || count === 0) return { count, max, atCap, text: null };
  const text = atCap
    ? `You're in ${max} of ${max} crews for this festival. Leave one to start another.`
    : `${count} of ${max} crews for this festival`;
  return { count, max, atCap, text };
}

export function memberCountLabel(count: number, maxMembers?: number | null): string {
  const base = count === 1 ? '1 member' : `${count} members`;
  if (!maxMembers || count < maxMembers - 5) return base;
  if (count >= maxMembers) return `${count} of ${maxMembers} members · full`;
  return `${count} of ${maxMembers} members`;
}

/** Mirrors `countActiveByCrew` in lib/db/stores/polls.ts: closed or past-deadline polls do not count. */
export function openPollState(
  polls: Array<{ closed?: boolean; closes_at?: string | null; closesAt?: string | null }>,
  now: number = Date.now(),
): { open: number; atCap: boolean; text: string | null } {
  const open = polls.filter((p) => {
    if (p.closed) return false;
    const closes = p.closes_at ?? p.closesAt;
    return !closes || new Date(closes).getTime() > now;
  }).length;
  const atCap = open >= MAX_OPEN_POLLS_PER_CREW;
  return { open, atCap, text: atCap ? crewCopy.pollCap : null };
}

/** Same path as the server's `buildAvatarUrl`. Web passes no origin; mobile passes FESTIE_ORIGIN. */
export function memberAvatarUrl(
  m: Pick<CrewMember, 'avatarKey' | 'avatarVersion'>,
  origin = '',
): string | undefined {
  if (!m.avatarKey || !m.avatarVersion) return undefined;
  return `${origin.replace(/\/$/, '')}/uploads/avatars/${encodeURIComponent(m.avatarKey)}.webp?v=${encodeURIComponent(m.avatarVersion)}`;
}

/** Everyone but `selfId`, earliest joiner first. Members without `joinedAt` go last. */
export function handOverCandidates(members: CrewMember[], selfId: string): CrewMember[] {
  return members
    .filter((m) => m.userId !== selfId)
    .map((m, i) => ({ m, i, t: m.joinedAt ? new Date(m.joinedAt).getTime() : Infinity }))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t < b.t ? -1 : 1))
    .map(({ m }) => m);
}

export interface OwnedCrewHandover {
  crew: Crew;
  candidates: CrewMember[];
  defaultOwnerId: string;
}

export function ownedCrewsForDeletion(
  crews: Crew[],
  userId: string,
): { handover: OwnedCrewHandover[]; soloCount: number } {
  const handover: OwnedCrewHandover[] = [];
  let soloCount = 0;
  for (const crew of crews) {
    if (crew.role !== 'owner' && crew.owner !== userId) continue;
    const candidates = handOverCandidates(crew.members ?? [], userId);
    const first = candidates[0];
    if (!first) soloCount += 1;
    else handover.push({ crew, candidates, defaultOwnerId: first.userId });
  }
  return { handover, soloCount };
}
