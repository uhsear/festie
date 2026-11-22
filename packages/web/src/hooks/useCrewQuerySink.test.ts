import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryObserver } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { createTestQueryClient } from '../test-utils';
import type { Socket } from 'socket.io-client';
import { useCrewRealtime } from '@festie/shared/hooks/useCrewRealtime';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { api } from '@festie/shared';
import { buildCrewQuerySink } from './useCrewQuerySink';
import { meetingPointsQuery } from '../lib/queryPersist';
import { pollsQueryOptions } from './useCrewAttention';

/**
 * These tests exercise the WEB crew-realtime wiring end to end:
 * the real shared `useCrewRealtime` event router + our `buildCrewQuerySink`,
 * driven by a fake socket. We assert that snake_case crew:* payloads scoped to
 * the active crew invalidate the matching TanStack Query keys (and that home
 * base applies to the crewStore instead of a query invalidation).
 */

const ACTIVE_CREW = 'crew-active-123';

// The sink fetches polls and meeting points through the query client; keep tests off the network.
beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue([]);
});
afterEach(() => {
  vi.restoreAllMocks();
});

// A minimal socket double: records handlers registered via `.on`, lets the test
// emit events, and reports `connected` so the join:crew lifecycle is exercised.
function makeFakeSocket() {
  const handlers: Record<string, (data: unknown) => void> = {};
  const emit = vi.fn();
  const socket = {
    connected: true,
    on: (event: string, fn: (data: unknown) => void) => {
      handlers[event] = fn;
    },
    off: (event: string) => {
      delete handlers[event];
    },
    emit,
  } as unknown as Socket;
  const fire = (event: string, data: unknown) => handlers[event]?.(data);
  return { socket, fire, emit, handlers };
}

function setActiveCrew(id: string | null) {
  useCrewStore.setState({
    activeCrew: id ? ({ id } as never) : null,
  });
}

describe('web crew-realtime query sink', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setActiveCrew(ACTIVE_CREW);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    setActiveCrew(null);
  });

  function renderWired(queryClient: QueryClient, fakeSocket: ReturnType<typeof makeFakeSocket>) {
    const sink = buildCrewQuerySink(queryClient);
    return renderHook(() =>
      useCrewRealtime({
        socket: fakeSocket.socket,
        getActiveCrewId: () => useCrewStore.getState().activeCrew?.id ?? null,
        sink,
        joinRoom: true,
      }),
    );
  }

  it('invalidates ["meeting-points", crewId] on crew:meeting-point-created (snake_case crew_id)', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    // Raw DB row shape: crew_id (snake_case) === the active crew.
    fakeSocket.fire('crew:meeting-point-created', {
      id: 'mp-1',
      crew_id: ACTIVE_CREW,
      created_by: 'u1',
      label: 'Main gate',
      location: 'North entrance',
      type: 'during',
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meeting-points', ACTIVE_CREW] });
  });

  it('invalidates ["polls", crewId] on crew:poll-voted', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    // poll-voted payload carries pollId, not crewId — the router scopes it to
    // the active crew, and the sink invalidates ['polls', <activeCrewId>].
    fakeSocket.fire('crew:poll-voted', { pollId: 'poll-9', userId: 'u2', optionIndex: 1 });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['polls', ACTIVE_CREW] });
  });

  it('invalidates expenses + expense-balances on crew:expense-added (after debounce)', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    fakeSocket.fire('crew:expense-added', { _v: 1, crewId: ACTIVE_CREW, expense: { id: 'e1' } });
    // Expense events are debounced (300ms) inside the shared hook.
    vi.advanceTimersByTime(300);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expenses', ACTIVE_CREW] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-balances', ACTIVE_CREW] });
  });

  it('invalidates ["crew-activity", crewId] on crew:activity (after debounce)', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    fakeSocket.fire('crew:activity', { _v: 1, crewId: ACTIVE_CREW, item: { id: 'a1', type: 'poll-created' } });
    // Activity events are debounced (300ms) inside the shared hook.
    vi.advanceTimersByTime(300);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crew-activity', ACTIVE_CREW] });
  });

  it('ignores events scoped to a different crew', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    fakeSocket.fire('crew:meeting-point-created', { id: 'mp-x', crew_id: 'some-other-crew' });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('routes crew:home-base-updated to crewStore.applyHomeBaseUpdate (not a query invalidation)', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const fakeSocket = makeFakeSocket();
    renderWired(queryClient, fakeSocket);

    fakeSocket.fire('crew:home-base-updated', {
      crewId: ACTIVE_CREW,
      location: 'Camp 42',
      time: '2026-06-02T18:00:00.000Z',
    });

    const crew = useCrewStore.getState().activeCrew as unknown as {
      homeBaseLocation: string | null;
      homeBaseTime: string | null;
    };
    expect(crew.homeBaseLocation).toBe('Camp 42');
    expect(crew.homeBaseTime).toBe('2026-06-02T18:00:00.000Z');
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('buildCrewQuerySink (direct mapping)', () => {
  let queryClient: QueryClient;
  let invalidate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  });

  it('maps each sink method to the expected query key(s)', () => {
    const sink = buildCrewQuerySink(queryClient);
    const crewId = 'c1';

    sink.onMeetingPointUpsert(crewId, {} as never);
    sink.onMeetingPointRemoved(crewId, 'mp1');
    sink.onPollCreated(crewId, { pollId: 'p', question: 'q', options: [], createdBy: 'u' });
    sink.onPollVoted(crewId, 'p', 'u', [0]);
    sink.onPollClosed(crewId, 'p');
    sink.onExpensesChanged(crewId);
    sink.onActivityLogged(crewId);
    sink.onPackingChanged(crewId);
    sink.onRidesChanged(crewId);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['meeting-points', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['polls', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expenses', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['expense-balances', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['settlement-plan', crewId] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['crew-activity', crewId] });
    expect(invalidate).toHaveBeenCalledTimes(9);
  });

  it('fills the crewStore from the query result with one request per event', async () => {
    const get = vi.mocked(api.get).mockImplementation(async (url: string) =>
      url.endsWith('/polls')
        ? { polls: [{ id: 'p1', votes: [{ user_id: 'u1', option: 0 }, { user_id: null, option: 1 }] }] }
        : { meetingPoints: [{ id: 'mp1' }] },
    );
    // Active observers are what make invalidateQueries refetch, so mount both first.
    const observers = [
      new QueryObserver(queryClient, pollsQueryOptions('c1')),
      new QueryObserver(queryClient, meetingPointsQuery('c1')),
    ];
    const unsubscribe = observers.map((o) => o.subscribe(() => {}));
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(observers.every((o) => !o.getCurrentResult().isFetching)).toBe(true));
    get.mockClear();
    const sink = buildCrewQuerySink(queryClient);

    sink.onMeetingPointUpsert('c1', {} as never);
    sink.onPollVoted('c1', 'p', 'u', [0]);
    await vi.waitFor(() => expect(useCrewStore.getState().polls).toHaveLength(1));
    await vi.waitFor(() => expect(useCrewStore.getState().meetingPoints).toHaveLength(1));

    expect(useCrewStore.getState().polls[0]!.votes).toEqual([{ user_id: 'u1', option: 0 }]);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('/crews/c1/polls');
    expect(get).toHaveBeenCalledWith('/crews/c1/meeting-points');
    unsubscribe.forEach((u) => u());
    useCrewStore.setState({ polls: [], meetingPoints: [] });
  });

  it('does not warn when a newer event cancels the in-flight reload', async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = buildCrewQuerySink(queryClient);
    sink.onPollClosed('c1', 'p');
    sink.onMeetingPointUpsert('c1', { id: 'mp' } as never);
    await queryClient.cancelQueries();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('warns and keeps the store when the fetch fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    useCrewStore.setState({ polls: [{ id: 'keep' } as never] });
    buildCrewQuerySink(queryClient).onPollClosed('c1', 'p');
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(useCrewStore.getState().polls).toHaveLength(1);
    warn.mockRestore();
    useCrewStore.setState({ polls: [] });
  });
});

describe('buildCrewQuerySink packing and rides', () => {
  const { loadPacking: realLoadPacking, loadRides: realLoadRides } = useCrewStore.getState();
  afterEach(() => {
    useCrewStore.setState({ activeCrew: null, loadPacking: realLoadPacking, loadRides: realLoadRides });
  });

  it('reloads the store lists for the active crew only', () => {
    const loadPacking = vi.fn().mockResolvedValue(undefined);
    const loadRides = vi.fn().mockResolvedValue(undefined);
    useCrewStore.setState({ activeCrew: { id: 'c1' } as never, loadPacking, loadRides });
    const sink = buildCrewQuerySink(createTestQueryClient());

    sink.onPackingChanged('c1');
    sink.onRidesChanged('c1');
    expect(loadPacking).toHaveBeenCalledWith('c1');
    expect(loadRides).toHaveBeenCalledWith('c1');

    sink.onPackingChanged('other');
    sink.onRidesChanged('other');
    expect(loadPacking).toHaveBeenCalledTimes(1);
    expect(loadRides).toHaveBeenCalledTimes(1);
  });
});

describe('buildCrewQuerySink crew days', () => {
  afterEach(() => {
    useCrewStore.setState({ activeCrew: null, crewDays: [] });
  });

  it('applies a days event to the crew store', () => {
    useCrewStore.setState({ activeCrew: { id: 'c1' } as never, crewDays: [] });
    const days = [{ userId: 'u2', dayIndex: 0, answer: 'no' as const }];
    buildCrewQuerySink(createTestQueryClient()).onDaysUpdated('c1', { crewId: 'c1', userId: 'u2', days });
    expect(useCrewStore.getState().crewDays).toEqual(days);
  });
});

describe('buildCrewQuerySink reconnect resync', () => {
  const real = useCrewStore.getState();
  const loaders = () => ({
    loadPacking: vi.fn().mockResolvedValue(undefined),
    loadRides: vi.fn().mockResolvedValue(undefined),
  });
  afterEach(() => {
    useUIStore.setState({ pendingSync: 0 });
    useCrewStore.setState({
      activeCrew: null,
      loadPacking: real.loadPacking,
      loadRides: real.loadRides,
    });
  });

  it('invalidates every crew list key and reloads packing and rides', () => {
    const l = loaders();
    useCrewStore.setState({ activeCrew: { id: 'c1' } as never, ...l });
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    buildCrewQuerySink(queryClient).onReconnectResync?.('c1');

    for (const key of ['meeting-points', 'polls', 'expenses', 'expense-balances', 'settlement-plan', 'crew-activity']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key, 'c1'] });
    }
    expect(invalidate).toHaveBeenCalledTimes(6);
    expect(l.loadPacking).toHaveBeenCalledWith('c1');
    expect(l.loadRides).toHaveBeenCalledWith('c1');
  });

  it('does nothing while offline writes are still queued', () => {
    const l = loaders();
    useCrewStore.setState({ activeCrew: { id: 'c1' } as never, ...l });
    useUIStore.setState({ pendingSync: 2 });
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    buildCrewQuerySink(queryClient).onReconnectResync?.('c1');

    expect(invalidate).not.toHaveBeenCalled();
    expect(l.loadPacking).not.toHaveBeenCalled();
    expect(l.loadRides).not.toHaveBeenCalled();
  });
});
