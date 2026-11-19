import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { api } from '../api';
import { drainQueue, type QueuedMutation } from '../offlineQueue';
import { bulkPickClientId, changedPickDeltas, legacyPickBody, pickDeltaBody } from '../pickDeltas';
import { useUIStore } from '../../stores/uiStore';
import { getStorage } from '../../platform/storage';

const QUEUE_KEY = 'festie-offline-queue';
const FAILED_KEY = 'festie-offline-failed';

describe('pick delta helpers', () => {
  it('builds a body with the deltas and the whole-map fallback', () => {
    expect(pickDeltaBody({ s1: 'must', s2: null }, { s1: 'must' })).toEqual({
      pickDeltas: { s1: 'must', s2: null },
      legacyPicks: { s1: 'must' },
    });
  });

  it('refuses an empty delta, which the server would reject as a validation error', () => {
    expect(() => pickDeltaBody({}, { s1: 'must' })).toThrow('at least one set');
  });

  it('diffs only the sets whose pick changed, and never emits a removal', () => {
    expect(changedPickDeltas({ a: 'must', b: 'maybe' }, { a: 'must', b: 'must', c: 'maybe' })).toEqual({
      b: 'must',
      c: 'maybe',
    });
  });

  it('gives each bulk write its own clientId', () => {
    expect(bulkPickClientId('p1')).not.toBe(bulkPickClientId('p1'));
  });

  describe('legacyPickBody', () => {
    const body = pickDeltaBody({ s1: 'must' }, { s1: 'must', s2: 'maybe' });
    const oldServer = { status: 400, code: 'VALIDATION_ERROR', message: 'At least one field required' };
    it('returns the whole-map body for the old-server rejection', () => {
      expect(legacyPickBody(body, oldServer)).toEqual({ picks: { s1: 'must', s2: 'maybe' } });
    });
    it('returns null for a validation error from a server that knows deltas', () => {
      expect(
        legacyPickBody(body, { status: 400, code: 'VALIDATION_ERROR', message: 'pickDeltas: pickDeltas needs at least one set' }),
      ).toBeNull();
      expect(legacyPickBody(body, { status: 400, code: 'VALIDATION_ERROR' })).toBeNull();
    });
    it('returns null for other failures and for bodies that are not delta writes', () => {
      expect(legacyPickBody(body, { status: 400, code: 'INVALID_INPUT' })).toBeNull();
      expect(legacyPickBody(body, { status: 409, code: 'VERSION_MISMATCH' })).toBeNull();
      expect(legacyPickBody(body, { status: 500 })).toBeNull();
      expect(legacyPickBody({ picks: {} }, oldServer)).toBeNull();
      expect(legacyPickBody({ pickDeltas: { s1: 'must' } }, oldServer)).toBeNull();
      expect(legacyPickBody(undefined, oldServer)).toBeNull();
    });
  });
});

const reply = (status: number, error?: { code: string; message: string }) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: { get: () => null },
    json: async () => (error ? { data: null, error } : { data: { id: 'p1' }, error: null }),
  }) as unknown as Response;

const OLD_SERVER = reply(400, { code: 'VALIDATION_ERROR', message: 'At least one field required' });

type Sent = { url: string; body: Record<string, unknown>; key?: string };

describe('pick delta writes through api and the offline queue', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const sent = (): Sent[] =>
    fetchSpy.mock.calls.map(([url, init]) => ({
      url: String(url),
      body: JSON.parse((init as { body: string }).body),
      key: (init as { headers: Record<string, string> }).headers['Idempotency-Key'],
    }));
  const queued = (): QueuedMutation[] => JSON.parse((getStorage().getItem(QUEUE_KEY) as string | null) ?? '[]');

  beforeEach(() => {
    getStorage().removeItem(QUEUE_KEY);
    getStorage().removeItem(FAILED_KEY);
    useUIStore.setState({ offlineMode: false, pendingSync: 0, failedSync: [] });
    fetchSpy = vi.fn(async () => reply(200));
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const queueOffline = async () => {
    useUIStore.setState({ offlineMode: true });
    await api.put('/profiles/p1', pickDeltaBody({ s1: 'must' }, { s1: 'must' }), { clientId: 'pick-p1-s1' });
    await api.put('/profiles/p1', pickDeltaBody({ s2: null }, { s1: 'must' }), { clientId: 'pick-p1-s2' });
    useUIStore.setState({ offlineMode: false });
  };

  it('replays each queued delta oldest-first with its own body, so picks it never named stay untouched', async () => {
    await queueOffline();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(queued().map((q) => q.body)).toEqual([
      { pickDeltas: { s1: 'must' }, legacyPicks: { s1: 'must' } },
      { pickDeltas: { s2: null }, legacyPicks: { s1: 'must' } },
    ]);

    await drainQueue();

    expect(sent().map((s) => s.body)).toEqual([
      { pickDeltas: { s1: 'must' }, legacyPicks: { s1: 'must' } },
      { pickDeltas: { s2: null }, legacyPicks: { s1: 'must' } },
    ]);
    expect(queued()).toEqual([]);
    expect(useUIStore.getState().failedSync).toEqual([]);
  });

  it('coalesces repeated offline toggles of one set into the latest delta', async () => {
    useUIStore.setState({ offlineMode: true });
    await api.put('/profiles/p1', pickDeltaBody({ s1: 'must' }, { s1: 'must' }), { clientId: 'pick-p1-s1' });
    await api.put('/profiles/p1', pickDeltaBody({ s1: null }, {}), { clientId: 'pick-p1-s1' });
    expect(queued()).toHaveLength(1);
    expect(queued()[0]!.body).toMatchObject({ pickDeltas: { s1: null } });
  });

  it('surfaces a rejected replay in failedSync with its body instead of dropping it', async () => {
    await queueOffline();
    fetchSpy.mockResolvedValueOnce(reply(400, { code: 'INVALID_INPUT', message: 'Pick references an unknown set' }));

    await drainQueue();

    const failed = useUIStore.getState().failedSync;
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ clientId: 'pick-p1-s1', error: 'Pick references an unknown set' });
    expect(failed[0]!.body).toMatchObject({ pickDeltas: { s1: 'must' } });
    expect(sent()).toHaveLength(2); // the next entry still replays
    expect(queued()).toEqual([]);
  });

  it('replays a coalesced per-set entry after a bulk entry queued between its two writes', async () => {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 10));
    useUIStore.setState({ offlineMode: true });
    await api.put('/profiles/p1', pickDeltaBody({ s1: 'must' }, { s1: 'must' }), { clientId: 'pick-p1-s1' });
    await api.put('/profiles/p1', pickDeltaBody({ s1: null }, {}), { clientId: bulkPickClientId('p1') });
    await api.put('/profiles/p1', pickDeltaBody({ s1: 'maybe' }, { s1: 'maybe' }), { clientId: 'pick-p1-s1' });
    useUIStore.setState({ offlineMode: false });

    await drainQueue();

    expect(sent().map((s) => s.body.pickDeltas)).toEqual([{ s1: null }, { s1: 'maybe' }]);
    vi.restoreAllMocks();
  });

  it('keeps a replay queued when the edge answers for a dead origin', async () => {
    await queueOffline();
    fetchSpy.mockResolvedValue(reply(530));

    await drainQueue();

    expect(queued()).toHaveLength(2);
    expect(useUIStore.getState().failedSync).toEqual([]);
  });

  describe('old server without pick deltas', () => {
    it('resends an online delta write as the whole map under a fresh Idempotency-Key', async () => {
      fetchSpy.mockResolvedValueOnce(OLD_SERVER);

      await api.put('/profiles/p1', pickDeltaBody({ s1: 'must' }, { s1: 'must', s2: 'maybe' }), {
        clientId: 'pick-p1-s1',
        headers: { 'Idempotency-Key': 'k1' },
      });

      expect(sent()).toEqual([
        { url: expect.stringContaining('/profiles/p1'), body: { pickDeltas: { s1: 'must' }, legacyPicks: { s1: 'must', s2: 'maybe' } }, key: 'k1' },
        { url: expect.stringContaining('/profiles/p1'), body: { picks: { s1: 'must', s2: 'maybe' } }, key: 'k1:legacy' },
      ]);
    });

    it('resends a replayed delta as the whole map, so the queued write still lands', async () => {
      await queueOffline();
      fetchSpy.mockResolvedValueOnce(OLD_SERVER).mockResolvedValueOnce(reply(200)).mockResolvedValueOnce(OLD_SERVER).mockResolvedValueOnce(reply(200));

      await drainQueue();

      expect(sent().map((s) => Object.keys(s.body))).toEqual([['pickDeltas', 'legacyPicks'], ['picks'], ['pickDeltas', 'legacyPicks'], ['picks']]);
      expect(queued()).toEqual([]);
      expect(useUIStore.getState().failedSync).toEqual([]);
    });

    it('queues the whole-map resend when the network drops during it', async () => {
      fetchSpy.mockResolvedValueOnce(OLD_SERVER).mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await api.put('/profiles/p1', pickDeltaBody({ s1: 'must' }, { s1: 'must', s2: 'maybe' }), { clientId: 'pick-p1-s1' });

      expect(queued().map((q) => q.body)).toEqual([{ picks: { s1: 'must', s2: 'maybe' } }]);
    });

    it('does not resend a whole map after any other 400, and does not loop on a rejected resend', async () => {
      fetchSpy.mockResolvedValueOnce(reply(400, { code: 'INVALID_INPUT', message: 'Too many picks' }));
      await expect(api.put('/profiles/p1', pickDeltaBody({ s1: 'must' }, { s1: 'must' }))).rejects.toMatchObject({ status: 400 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockResolvedValue(OLD_SERVER);
      await expect(api.put('/profiles/p1', pickDeltaBody({ s1: 'must' }, { s1: 'must' }))).rejects.toMatchObject({ status: 400 });
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('leaves a whole-map write and other paths alone', async () => {
      fetchSpy.mockResolvedValue(OLD_SERVER);
      await expect(api.put('/profiles/p1', { picks: { s1: 'must' } })).rejects.toMatchObject({ status: 400 });
      await expect(api.put('/crews/c1/status', pickDeltaBody({ s1: 'must' }, { s1: 'must' }))).rejects.toMatchObject({ status: 400 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });
});
