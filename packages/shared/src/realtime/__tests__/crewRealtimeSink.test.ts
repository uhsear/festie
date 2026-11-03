import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createStoreSink } from '../crewRealtimeSink';
import { useCrewStore } from '../../stores/crewStore';
import { useLiveLocationStore } from '../../stores/liveLocationStore';
import { useUIStore } from '../../stores/uiStore';
import type { SosEntry } from '../../types/domain';

const CREW = 'crew-1';

function makeSos(userId: string, username: string): SosEntry {
  return {
    crewId: CREW,
    userId,
    username,
    message: 'Need help at main stage',
    position: { lat: 40.1, lng: -74.1, accuracy: 8, capturedAt: '2026-06-06T12:00:00.000Z' },
    activityId: `act-${userId}`,
    raisedAt: '2026-06-06T12:00:00.000Z',
  };
}

describe('crewRealtimeSink: sos:cleared clears only the raiser it names', () => {
  beforeEach(() => {
    useLiveLocationStore.getState().reset();
    useLiveLocationStore.setState({ crewId: CREW });
  });

  // Regression: both sinks called clearSos() with no argument, which the store
  // documents as the drop-every-SOS path. Resolving one member's SOS therefore
  // wiped every other member's still-active SOS from the map.
  it('leaves another member SOS active when one is cleared', () => {
    const sink = createStoreSink(useCrewStore, useLiveLocationStore);

    sink.onSosRaised(CREW, makeSos('user-a', 'Alice'));
    sink.onSosRaised(CREW, makeSos('user-b', 'Bob'));
    expect(useLiveLocationStore.getState().activeSosList).toHaveLength(2);

    sink.onSosCleared(CREW, 'user-a', 'Alice');

    const remaining = useLiveLocationStore.getState().activeSosList;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBe('user-b');
  });

  it('is a no-op for a raiser with no active SOS', () => {
    const sink = createStoreSink(useCrewStore, useLiveLocationStore);

    sink.onSosRaised(CREW, makeSos('user-b', 'Bob'));
    sink.onSosCleared(CREW, 'user-a', 'Alice');

    expect(useLiveLocationStore.getState().activeSosList).toHaveLength(1);
  });
});

describe('crewRealtimeSink: onHomeBaseUpdated', () => {
  it('passes planB through and omits it when the payload has none', () => {
    const applyHomeBaseUpdate = vi.fn();
    const api = { getState: () => ({ applyHomeBaseUpdate }) } as never;
    const sink = createStoreSink(api);
    sink.onHomeBaseUpdated('c1', { location: 'Gate', time: null, planB: 'Top of the hour' });
    expect(applyHomeBaseUpdate).toHaveBeenLastCalledWith('c1', { location: 'Gate', time: null, planB: 'Top of the hour' });
    sink.onHomeBaseUpdated('c1', { location: 'Gate', time: null });
    expect(applyHomeBaseUpdate.mock.calls.at(-1)?.[1]).not.toHaveProperty('planB');
  });
});

describe('crewRealtimeSink: onDaysUpdated', () => {
  it('reaches applyCrewDays', () => {
    const applyCrewDays = vi.fn();
    const api = { getState: () => ({ applyCrewDays }) } as never;
    const payload = { crewId: 'c1', userId: 'u1', days: [{ userId: 'u1', dayIndex: 0, answer: 'no' as const }] };
    createStoreSink(api).onDaysUpdated('c1', payload);
    expect(applyCrewDays).toHaveBeenCalledWith(payload);
  });
});

describe('crewRealtimeSink: onSosResync', () => {
  it('re-reads the active SOS list for the crew', () => {
    const loadActiveSos = vi.fn().mockResolvedValue(undefined);
    const api = { getState: () => ({ applyPeerUpdate: vi.fn(), removePeer: vi.fn(), applySos: vi.fn(), clearSos: vi.fn(), loadActiveSos }) };
    createStoreSink(useCrewStore, api).onSosResync?.('c1');
    expect(loadActiveSos).toHaveBeenCalledWith('c1');
  });
});

describe('crewRealtimeSink: onPollVoted', () => {
  it('passes every chosen option index to applyPollVote', () => {
    const applyPollVote = vi.fn();
    const crewApi = { getState: () => ({ ...useCrewStore.getState(), applyPollVote }) };
    createStoreSink(crewApi).onPollVoted('c1', 'poll-1', 'user-1', [0, 2]);
    expect(applyPollVote).toHaveBeenCalledWith('poll-1', 'user-1', [0, 2]);
  });
});

describe('crewRealtimeSink: packing and rides reloads', () => {
  const makeApi = (activeId: string | null) => {
    const loadPacking = vi.fn().mockResolvedValue(undefined);
    const loadRides = vi.fn().mockResolvedValue(undefined);
    const storeApi = {
      getState: () => ({ activeCrew: activeId ? { id: activeId } : null, loadPacking, loadRides }),
    };
    return { loadPacking, loadRides, sink: createStoreSink(storeApi as never) };
  };

  it('reloads both lists for the active crew', () => {
    const { loadPacking, loadRides, sink } = makeApi(CREW);
    sink.onPackingChanged(CREW);
    sink.onRidesChanged(CREW);
    expect(loadPacking).toHaveBeenCalledWith(CREW);
    expect(loadRides).toHaveBeenCalledWith(CREW);
  });

  it('does nothing when the active crew changed before the flush', () => {
    const { loadPacking, loadRides, sink } = makeApi('crew-2');
    sink.onPackingChanged(CREW);
    sink.onRidesChanged(CREW);
    expect(loadPacking).not.toHaveBeenCalled();
    expect(loadRides).not.toHaveBeenCalled();
  });
});

describe('crewRealtimeSink: onReconnectResync', () => {
  const LOADERS = [
    'loadMeetingPoints',
    'loadPolls',
    'loadExpenses',
    'loadPacking',
    'loadRides',
    'loadActivity',
    'loadCrewDays',
  ] as const;
  const makeApi = (activeId: string | null) => {
    const loaders = Object.fromEntries(LOADERS.map((k) => [k, vi.fn().mockResolvedValue(undefined)]));
    const storeApi = { getState: () => ({ activeCrew: activeId ? { id: activeId } : null, ...loaders }) };
    return { loaders, sink: createStoreSink(storeApi as never) };
  };

  afterEach(() => {
    useUIStore.setState({ pendingSync: 0 });
  });

  it('reloads the seven crew lists for the active crew', () => {
    const { loaders, sink } = makeApi('c1');
    sink.onReconnectResync?.('c1');
    for (const k of LOADERS) expect(loaders[k]).toHaveBeenCalledWith('c1');
  });

  it('reloads nothing while offline writes are still queued', () => {
    useUIStore.setState({ pendingSync: 1 });
    const { loaders, sink } = makeApi('c1');
    sink.onReconnectResync?.('c1');
    for (const k of LOADERS) expect(loaders[k]).not.toHaveBeenCalled();
  });

  it('reloads nothing when the crew is no longer active', () => {
    const { loaders, sink } = makeApi('c2');
    sink.onReconnectResync?.('c1');
    for (const k of LOADERS) expect(loaders[k]).not.toHaveBeenCalled();
  });

  it('logs a failed reload instead of swallowing it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { loaders, sink } = makeApi('c1');
    loaders.loadPolls.mockRejectedValueOnce(new Error('offline'));
    sink.onReconnectResync?.('c1');
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('crew resync failed', expect.any(Error)));
    warn.mockRestore();
  });
});
