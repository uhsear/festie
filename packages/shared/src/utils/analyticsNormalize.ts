/**
 * Shared normalizer for GET /admin/analytics.
 *
 * The server returns numeric aggregates as strings (raw SQL coercion), so every
 * numeric field goes through toNum(). Platform-agnostic: no DOM/window, no
 * Node-only APIs — safe for both web and React Native consumers.
 *
 * Extracted from packages/web/src/components/admin/analyticsTypes.ts so mobile
 * can reuse the same types and normalization without a web dependency.
 */

export interface TopSetData {
  artist: string;
  stageId: string | null;
  dayIndex: number | null;
  festivalId: string;
  startTime: string | null;
  endTime: string | null;
  pickCount: number;
  mustCount: number;
  wantCount: number;
  maybeCount: number;
  festivalName: string;
  dayLabel: string | null;
}

export interface ActiveUser {
  id: string;
  username: string;
  profileCount: number;
  totalPicks: number;
  lastActive: string;
}

export interface CrewSummary {
  id: string;
  name: string;
  festivalId: string;
  memberCount: number;
  createdAt: string;
  festivalName: string;
}

export interface FestivalStatData {
  id: string;
  name: string;
  profileCount: number;
  uniqueSetsPicked: number;
  totalPicks: number;
}

export interface AnalyticsTotals {
  signedUp: number;
  usersWithPlan: number;
  plans: number;
  plansWithPicks: number;
  usersWithPick: number;
  picks: number;
  crews: number;
  crewMembers: number;
  usersInCrews: number;
  crewsWithTwoPlus: number;
}

export interface AnalyticsInstall {
  days: number;
  shown: number;
  accepted: number;
  dismissed: number;
}

export interface AnalyticsData {
  scope: { festivalId: string | null; festivalName: string | null };
  totals: AnalyticsTotals;
  pickDistribution: { must: number; want: number; maybe: number };
  install: AnalyticsInstall;
  topSets: TopSetData[];
  activeUsers: ActiveUser[];
  crews: CrewSummary[];
  festivalStats: FestivalStatData[];
  generatedAt: string | null;
}

function toNum(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

export function normalizeAnalytics(raw: unknown): AnalyticsData {
  const r = (raw ?? {}) as Record<string, unknown>;
  const scope = obj(r.scope);
  const t = obj(r.totals);
  const dist = obj(r.pickDistribution);
  const inst = obj(r.install);
  const topSets = Array.isArray(r.topSets) ? r.topSets : [];
  const activeUsers = Array.isArray(r.activeUsers) ? r.activeUsers : [];
  const crews = Array.isArray(r.crews) ? r.crews : [];
  const festivalStats = Array.isArray(r.festivalStats) ? r.festivalStats : [];
  return {
    scope: {
      festivalId: typeof scope.festivalId === 'string' ? scope.festivalId : null,
      festivalName: typeof scope.festivalName === 'string' ? scope.festivalName : null,
    },
    totals: {
      signedUp: toNum(t.signedUp),
      usersWithPlan: toNum(t.usersWithPlan),
      plans: toNum(t.plans),
      plansWithPicks: toNum(t.plansWithPicks),
      usersWithPick: toNum(t.usersWithPick),
      picks: toNum(t.picks),
      crews: toNum(t.crews),
      crewMembers: toNum(t.crewMembers),
      usersInCrews: toNum(t.usersInCrews),
      crewsWithTwoPlus: toNum(t.crewsWithTwoPlus),
    },
    pickDistribution: { must: toNum(dist.must), want: toNum(dist.want), maybe: toNum(dist.maybe) },
    install: {
      days: toNum(inst.days) || 30,
      shown: toNum(inst.shown),
      accepted: toNum(inst.accepted),
      dismissed: toNum(inst.dismissed),
    },
    topSets: topSets.map((s: Record<string, unknown>) => ({
      artist: toStr(s?.artist),
      stageId: typeof s?.stageId === 'string' ? s.stageId : null,
      dayIndex: typeof s?.dayIndex === 'number' ? s.dayIndex : null,
      festivalId: toStr(s?.festivalId),
      startTime: typeof s?.startTime === 'string' ? s.startTime : null,
      endTime: typeof s?.endTime === 'string' ? s.endTime : null,
      pickCount: toNum(s?.pickCount),
      mustCount: toNum(s?.mustCount),
      wantCount: toNum(s?.wantCount),
      maybeCount: toNum(s?.maybeCount),
      festivalName: toStr(s?.festivalName),
      dayLabel: typeof s?.dayLabel === 'string' ? s.dayLabel : null,
    })),
    activeUsers: activeUsers.map((u: Record<string, unknown>) => ({
      id: toStr(u?.id),
      username: toStr(u?.username),
      profileCount: toNum(u?.profileCount),
      totalPicks: toNum(u?.totalPicks),
      lastActive: toStr(u?.lastActive),
    })),
    crews: crews.map((c: Record<string, unknown>) => ({
      id: toStr(c?.id),
      name: toStr(c?.name),
      festivalId: toStr(c?.festivalId),
      memberCount: toNum(c?.memberCount),
      createdAt: toStr(c?.createdAt),
      festivalName: toStr(c?.festivalName),
    })),
    festivalStats: festivalStats.map((f: Record<string, unknown>) => ({
      id: toStr(f?.id),
      name: toStr(f?.name),
      profileCount: toNum(f?.profileCount),
      uniqueSetsPicked: toNum(f?.uniqueSetsPicked),
      totalPicks: toNum(f?.totalPicks),
    })),
    generatedAt: typeof r.generatedAt === 'string' ? r.generatedAt : null,
  };
}

export const ANALYTICS_DEFAULTS: AnalyticsData = {
  scope: { festivalId: null, festivalName: null },
  totals: {
    signedUp: 0,
    usersWithPlan: 0,
    plans: 0,
    plansWithPicks: 0,
    usersWithPick: 0,
    picks: 0,
    crews: 0,
    crewMembers: 0,
    usersInCrews: 0,
    crewsWithTwoPlus: 0,
  },
  pickDistribution: { must: 0, want: 0, maybe: 0 },
  install: { days: 30, shown: 0, accepted: 0, dismissed: 0 },
  topSets: [],
  activeUsers: [],
  crews: [],
  festivalStats: [],
  generatedAt: null,
};

/**
 * Format an ISO date string as YYYY-MM-DD (first 10 chars).
 * Returns "—" for empty/invalid input.
 */
export function formatDate(s: string): string {
  if (!s) return '—';
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return s;
  }
}

/**
 * Relative-time label from an ISO date string (e.g. lastActive from the
 * analytics API). Different from the epoch-ms `timeAgo` in ./timeAgo — this
 * accepts the ISO strings the server returns and collapses invalid input to "—".
 */
export function timeAgoFromIso(s: string): string {
  if (!s) return '—';
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return s;
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function pct(n: number, d: number): string {
  return `${d > 0 ? Math.round((n / d) * 100) : 0}%`;
}

const avg = (n: number, d: number): string => (n / d).toFixed(1);

export function analyticsQuestions(data: AnalyticsData): Array<{ id: string; question: string; answer: string }> {
  const { totals: t, install: i } = data;
  const noPlan = 'No one has a plan yet.';
  const qs = [
    {
      id: 'picked',
      question: 'How many people picked at least one set?',
      answer: t.usersWithPlan
        ? `${t.usersWithPick} of ${t.usersWithPlan} people with a plan (${pct(t.usersWithPick, t.usersWithPlan)}).`
        : noPlan,
    },
    {
      id: 'crewed',
      question: 'How many people are in a crew?',
      answer: t.usersWithPlan
        ? `${t.usersInCrews} of ${t.usersWithPlan} people with a plan (${pct(t.usersInCrews, t.usersWithPlan)}).`
        : noPlan,
    },
    {
      id: 'crewSize',
      question: 'How many crews have 2 or more members?',
      answer: t.crews
        ? `${t.crewsWithTwoPlus} of ${t.crews} crews. The average crew has ${avg(t.crewMembers, t.crews)} members.`
        : 'No crews yet.',
    },
    {
      id: 'picksPerPlan',
      question: 'How many sets does a plan pick?',
      answer: t.plansWithPicks
        ? `${avg(t.picks, t.plansWithPicks)} on average, across ${t.plansWithPicks} plans with at least one pick.`
        : 'No plan has a pick yet.',
    },
  ];
  if (data.scope.festivalId) return qs;
  qs.push({
    id: 'install',
    question: 'Do people install the web app?',
    answer: i.shown
      ? `In the last 30 days the install button was offered ${i.shown} times: ${i.accepted} installed and ${i.dismissed} said no.`
      : 'The install button was not offered in the last 30 days.',
  });
  return qs;
}

export function analyticsScopeLine(data: AnalyticsData): string {
  if (data.scope.festivalId) {
    return `At ${data.scope.festivalName ?? ''}: ${data.totals.usersWithPlan} people with a plan.`;
  }
  return `Across all ${data.festivalStats.length} festivals and ${data.totals.signedUp} accounts.`;
}

export function funnelSteps(data: AnalyticsData): Array<{ label: string; count: number; pctOfStart: string }> {
  const t = data.totals;
  const steps: Array<[string, number]> = [
    ['Signed up', t.signedUp],
    ['Joined a festival', t.usersWithPlan],
    ['Picked a set', t.usersWithPick],
    ['Joined a crew', t.usersInCrews],
  ];
  return steps.map(([label, count]) => ({ label, count, pctOfStart: pct(count, t.signedUp) }));
}
