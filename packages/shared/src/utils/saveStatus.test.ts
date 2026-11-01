import { describe, it, expect } from 'vitest';
import { saveStatus } from './saveStatus';

const idle = { savesInFlight: 0, failedPicks: 0, failedSync: 0, offline: false, pendingSync: 0, lastSavedAt: null };

describe('saveStatus', () => {
  it('failed wins over everything (failed picks or failed sync)', () => {
    const busy = { savesInFlight: 2, offline: true, pendingSync: 3, lastSavedAt: 1 };
    expect(saveStatus({ ...idle, ...busy, failedPicks: 1 })).toEqual({ kind: 'failed', label: 'Not saved' });
    expect(saveStatus({ ...idle, ...busy, failedSync: 1 })).toEqual({ kind: 'failed', label: 'Not saved' });
  });

  it('offline with pending writes', () => {
    expect(saveStatus({ ...idle, offline: true, pendingSync: 1, savesInFlight: 1 })).toEqual({
      kind: 'offline',
      label: 'Offline, will sync',
    });
  });

  it('saving while a write is in flight', () => {
    expect(saveStatus({ ...idle, savesInFlight: 1, pendingSync: 1, lastSavedAt: 1 })).toEqual({
      kind: 'saving',
      label: 'Saving…',
    });
  });

  it('syncing while online with a pending queue', () => {
    expect(saveStatus({ ...idle, pendingSync: 2, lastSavedAt: 1 })).toEqual({ kind: 'syncing', label: 'Syncing…' });
  });

  it('saved after a server-acknowledged write', () => {
    expect(saveStatus({ ...idle, lastSavedAt: 123 })).toEqual({ kind: 'saved', label: 'Saved' });
  });

  it('null when nothing has happened (offline with an empty queue included)', () => {
    expect(saveStatus(idle)).toBeNull();
    expect(saveStatus({ ...idle, offline: true })).toBeNull();
  });
});
