/** The read-only growth report from `GET /admin/growth`. Every count is a floor: mobile sign-ups and visitors who cleared storage carry no ref. */
export interface AdminGrowthReport {
  days: number;
  signupsByRef: { day: string; ref: string; signups: number }[];
  followsPerDay: { day: string; festivalId: string; festivalName: string | null; follows: number }[];
  followers: { festivalId: string; festivalName: string | null; followers: number }[];
  newsSends: { day: string; type: string; count: number }[];
  newsHeld: { day: string; type: string; count: number }[];
  generatedAt: string;
}

export interface GrowthTotal {
  key: string;
  label: string;
  total: number;
}

/** Sums rows that share a key, biggest first, ties by label. */
function totalBy<T>(rows: T[], key: (row: T) => string, label: (row: T) => string, count: (row: T) => number): GrowthTotal[] {
  const totals = new Map<string, GrowthTotal>();
  for (const row of rows) {
    const id = key(row);
    const entry = totals.get(id) ?? { key: id, label: label(row), total: 0 };
    entry.total += count(row);
    totals.set(id, entry);
  }
  return [...totals.values()].sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** The window totals the admin card shows: per ref, per festival and per news type. */
export function summarizeGrowth(report: AdminGrowthReport) {
  const festivalLabel = (row: { festivalId: string; festivalName: string | null }) => row.festivalName || row.festivalId;
  return {
    signups: totalBy(report.signupsByRef, (r) => r.ref, (r) => r.ref, (r) => r.signups),
    newFollows: totalBy(report.followsPerDay, (r) => r.festivalId, festivalLabel, (r) => r.follows),
    followers: totalBy(report.followers, (r) => r.festivalId, festivalLabel, (r) => r.followers),
    newsSent: totalBy(report.newsSends, (r) => r.type, (r) => r.type, (r) => r.count),
    newsHeld: totalBy(report.newsHeld, (r) => r.type, (r) => r.type, (r) => r.count),
  };
}
