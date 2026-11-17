import { describe, it, expect } from 'vitest';
import { summarizeGrowth, type AdminGrowthReport } from './adminGrowth';

const report: AdminGrowthReport = {
  days: 30,
  signupsByRef: [
    { day: '2026-11-02', ref: 'share-festival', signups: 2 },
    { day: '2026-11-01', ref: 'share-festival', signups: 1 },
    { day: '2026-11-01', ref: 'crew-invite', signups: 5 },
  ],
  followsPerDay: [
    { day: '2026-11-02', festivalId: 'f1', festivalName: 'Fest One', follows: 3 },
    { day: '2026-11-01', festivalId: 'f1', festivalName: 'Fest One', follows: 1 },
    { day: '2026-11-01', festivalId: 'f2', festivalName: null, follows: 9 },
  ],
  followers: [{ festivalId: 'f1', festivalName: 'Fest One', followers: 12 }],
  newsSends: [
    { day: '2026-11-01', type: 'lineup_drop', count: 4 },
    { day: '2026-11-02', type: 'lineup_drop', count: 6 },
  ],
  newsHeld: [],
  generatedAt: '2026-11-03T00:00:00Z',
};

describe('summarizeGrowth', () => {
  it('sums each window per key, biggest first, and names an unnamed festival by id', () => {
    const summary = summarizeGrowth(report);
    expect(summary.signups).toEqual([
      { key: 'crew-invite', label: 'crew-invite', total: 5 },
      { key: 'share-festival', label: 'share-festival', total: 3 },
    ]);
    expect(summary.newFollows.map((r) => [r.label, r.total])).toEqual([
      ['f2', 9],
      ['Fest One', 4],
    ]);
    expect(summary.followers[0]).toEqual({ key: 'f1', label: 'Fest One', total: 12 });
    expect(summary.newsSent).toEqual([{ key: 'lineup_drop', label: 'lineup_drop', total: 10 }]);
    expect(summary.newsHeld).toEqual([]);
  });
});
