import { offlineSummary } from './offlineSummary';

const ready = (syncedAt: number) => ({ status: 'ready' as const, syncedAt });
const idle = { status: 'idle' as const, syncedAt: null };
const err = { status: 'error' as const, syncedAt: null };

describe('offlineSummary', () => {
  it('collapses with the newest sync time when every step is ready', () => {
    expect(offlineSummary([ready(100), ready(300), ready(200)], false)).toEqual({ collapsed: true, lastSyncedAt: 300 });
  });
  it('collapses a past festival with partial readiness', () => {
    expect(offlineSummary([ready(100), idle], true)).toEqual({ collapsed: true, lastSyncedAt: 100 });
  });
  it('does not collapse partial readiness for a live festival', () => {
    expect(offlineSummary([ready(100), idle], false).collapsed).toBe(false);
  });
  it('does not collapse when nothing has synced, even if past', () => {
    expect(offlineSummary([idle, idle], true)).toEqual({ collapsed: false, lastSyncedAt: null });
  });
  it('does not collapse when one step errored', () => {
    expect(offlineSummary([ready(100), err], false).collapsed).toBe(false);
  });
});
