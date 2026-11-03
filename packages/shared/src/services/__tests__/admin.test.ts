import { describe, it, expect, afterEach, vi } from 'vitest';
import { api, ApiClientError } from '../api';
import { fetchAdminPickInsight, fetchAuditPage, exportAuditCsv, fetchAdminUsers, fetchAdminUserDetail, withReauth, describeRemovals, formatImportCounts, removalFromError } from '../admin';

const jsonResponse = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response;

afterEach(() => vi.unstubAllGlobals());

describe('fetchAuditPage', () => {
  it('reads nextCursor and total from meta and sends filters', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, { data: [{ id: 'a' }], error: null, meta: { total: 7, limit: 1, nextCursor: 'c1' } }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const page = await fetchAuditPage({ scope: 'user', actor: 'bob', cursor: null });
    expect(page).toEqual({ entries: [{ id: 'a' }], nextCursor: 'c1', total: 7 });
    const url = String((fetchSpy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('scope=user');
    expect(url).toContain('actor=bob');
    expect(url).not.toContain('cursor');
  });
});

describe('fetchAuditPage user filter', () => {
  it('sends user', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: [], error: null, meta: { total: 0 } }));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchAuditPage({ user: 'sam' });
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain('user=sam');
  });
});

describe('exportAuditCsv', () => {
  const entry = (id: string) => ({ id, action: 'user.deleted', createdAt: '2026-10-31T00:00:00.000Z', details: null });
  const paged = (pages: Array<{ ids: string[]; next: string | null }>) => {
    let i = 0;
    return vi.fn(async () => {
      const p = pages[i++];
      return jsonResponse(200, { data: p.ids.map(entry), error: null, meta: { total: 9, nextCursor: p.next } });
    });
  };

  it('follows nextCursor across pages', async () => {
    const fetchSpy = paged([
      { ids: ['1', '2'], next: 'c1' },
      { ids: ['3', '4'], next: 'c2' },
      { ids: ['5'], next: null },
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    const r = await exportAuditCsv({ actor: 'asir' });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(r.rows).toBe(5);
    expect(r.capped).toBe(false);
    expect(r.csv.split(String.fromCharCode(13, 10))).toHaveLength(6);
    const urls = fetchSpy.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls[0]).toContain('limit=200');
    expect(urls[0]).toContain('actor=asir');
    expect(urls[1]).toContain('cursor=c1');
  });

  it('stops at maxRows and reports capped', async () => {
    const fetchSpy = paged([
      { ids: ['1', '2'], next: 'c1' },
      { ids: ['3', '4'], next: 'c2' },
      { ids: ['5', '6'], next: 'c3' },
    ]);
    vi.stubGlobal('fetch', fetchSpy);
    const r = await exportAuditCsv({}, { maxRows: 4 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(r.rows).toBe(4);
    expect(r.capped).toBe(true);
  });
});

describe('fetchAdminUsers', () => {
  it('reads meta.pagination and sends search and cursor', async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(200, {
        data: [{ id: 'u1' }],
        error: null,
        meta: { pagination: { hasMore: true, nextCursor: 'c2', pageSize: 1, total: 4 } },
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const page = await fetchAdminUsers({ search: 'bob', cursor: 'c1', limit: 1 });
    expect(page).toEqual({ users: [{ id: 'u1' }], nextCursor: 'c2', total: 4 });
    const url = String((fetchSpy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('search=bob');
    expect(url).toContain('cursor=c1');
  });
});

describe('fetchAdminUserDetail', () => {
  it('encodes the id in the path', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: { user: {} }, error: null }));
    vi.stubGlobal('fetch', fetchSpy);
    await fetchAdminUserDetail('a/b c');
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain('/admin/users/a%2Fb%20c');
  });
});

describe('withReauth', () => {
  const reauthErr = () => new ApiClientError('Confirm your password to continue.', 403, 'REAUTH_REQUIRED');

  it('retries once after REAUTH_REQUIRED', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: { reauthUntil: 'x' }, error: null }));
    vi.stubGlobal('fetch', fetchSpy);
    const run = vi.fn().mockRejectedValueOnce(reauthErr()).mockResolvedValueOnce('done');
    const result = await withReauth(run, async () => 'pw');
    expect(result).toBe('done');
    expect(run).toHaveBeenCalledTimes(2);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/auth/reauth');
    expect(init.body).toBe(JSON.stringify({ password: 'pw' }));
  });

  it('posts a provider body as-is', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: { reauthUntil: 'x' }, error: null }));
    vi.stubGlobal('fetch', fetchSpy);
    const run = vi.fn().mockRejectedValueOnce(reauthErr()).mockResolvedValueOnce('done');
    const body = { provider: 'google' as const, idToken: 'tok'.repeat(10), nonce: 'n'.repeat(20) };
    expect(await withReauth(run, async () => body)).toBe('done');
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('returns null on cancel', async () => {
    const run = vi.fn().mockRejectedValue(reauthErr());
    expect(await withReauth(run, async () => null)).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('re-throws other errors', async () => {
    const boom = new ApiClientError('nope', 500, 'INTERNAL');
    await expect(withReauth(() => Promise.reject(boom), async () => 'pw')).rejects.toBe(boom);
  });

  it('re-throws PASSWORD_INCORRECT from the reauth call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(403, { data: null, error: { code: 'PASSWORD_INCORRECT', message: 'bad' } })),
    );
    const run = vi.fn().mockRejectedValue(reauthErr());
    await expect(withReauth(run, async () => 'pw')).rejects.toMatchObject({ code: 'PASSWORD_INCORRECT' });
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('describeRemovals', () => {
  it('joins plural parts with a final and', () => {
    expect(describeRemovals({ days: 1, sets: 24, picks: 113, ratings: 0 })).toBe(
      'This save removes 1 day, 24 sets and 113 picks. People who picked these sets lose those picks. This cannot be undone.',
    );
  });
  it('handles singular and a single part', () => {
    expect(describeRemovals({ days: 0, sets: 1, picks: 1, ratings: 0 })).toContain('removes 1 set and 1 pick.');
    expect(describeRemovals({ days: 0, sets: 0, picks: 2, ratings: 0 })).toContain('removes 2 picks.');
  });
});

describe('formatImportCounts', () => {
  it('leaves out zero parts', () => {
    expect(formatImportCounts({ new: 3, update: 0, unchanged: 2, error: 0 })).toBe('3 new · 2 unchanged');
    expect(formatImportCounts({ new: 0, update: 1, unchanged: 0, error: 2 })).toBe('1 will change · 2 need fixing');
  });
  it('shows 0 new when everything is zero', () => {
    expect(formatImportCounts({ new: 0, update: 0, unchanged: 0, error: 0 })).toBe('0 new');
  });
});

describe('ApiClientError.details', () => {
  it('carries removal from a CONFIRM_REMOVALS response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(409, {
          data: null,
          error: { code: 'CONFIRM_REMOVALS', message: 'm', removal: { days: 1, sets: 2, picks: 3, ratings: 0 } },
        }),
      ),
    );
    const err = await api.put('/admin/festivals/f1', {}).catch((e: unknown) => e);
    expect((err as ApiClientError).details?.removal).toEqual({ days: 1, sets: 2, picks: 3, ratings: 0 });
    expect(removalFromError(err)).toEqual({ days: 1, sets: 2, picks: 3, ratings: 0 });
  });
});

describe('fetchAdminPickInsight', () => {
  it('encodes the festival id in the path', async () => {
    const fixture = { festivalId: 'a b', sets: [], clashes: [] };
    const fetchSpy = vi.fn(async () => jsonResponse(200, { data: fixture, error: null }));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await fetchAdminPickInsight('a b')).toEqual(fixture);
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain('/admin/analytics/festivals/a%20b/picks');
  });
});
