import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => {
  class ApiClientError extends Error {
    constructor(
      message: string,
      public status: number,
      public code?: string,
    ) {
      super(message);
    }
  }
  return { api: { post: vi.fn(), get: vi.fn() }, ApiClientError, getApiBase: () => '/api/v1' };
});

import { api } from '../api';
import { ApiClientError } from '../api';
import {
  fetchShareLink,
  fetchCalendarLinks,
  fetchSharingStatus,
  resetShareLinks,
  sharedPicksJsonUrl,
  fetchSharedPicks,
  fetchPrintableSchedule,
} from '../sharing';

const post = vi.mocked(api.post);
const get = vi.mocked(api.get);

beforeEach(() => vi.clearAllMocks());

describe('sharing service', () => {
  it('fetchShareLink posts the encoded id and builds the url', async () => {
    post.mockResolvedValue({ token: 'tok1' });
    const r = await fetchShareLink('fest 1');
    expect(post).toHaveBeenCalledWith('/account/share-link/fest%201');
    expect(r).toEqual({ token: 'tok1', url: 'https://festie.us/s/tok1' });
    expect((await fetchShareLink('f', 'http://localhost:5173')).url).toBe('http://localhost:5173/s/tok1');
  });

  it('fetchCalendarLinks posts and returns subscribe links', async () => {
    post.mockResolvedValue({ url: 'https://festie.us/cal/t.ics' });
    const r = await fetchCalendarLinks('f1');
    expect(post).toHaveBeenCalledWith('/calendar-sync/f1');
    expect(r.webcalUrl).toBe('webcal://festie.us/cal/t.ics');
    expect(r.httpsUrl).toBe('https://festie.us/cal/t.ics');
  });

  it('status and reset hit the account endpoints', async () => {
    get.mockResolvedValue({ publicSchedule: true, publicFestival: null, linksResetAt: null });
    expect((await fetchSharingStatus()).publicSchedule).toBe(true);
    expect(get).toHaveBeenCalledWith('/account/sharing');
    post.mockResolvedValue({ linksResetAt: 'x' });
    await resetShareLinks();
    expect(post).toHaveBeenCalledWith('/account/sharing/reset');
  });
});

describe('shared picks', () => {
  const fetchMock = vi.fn();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));

  const res = (body: unknown, status = 200) => ({
    ok: status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  });
  const payload = {
    username: 'alice',
    festivalName: 'Fest',
    festivalId: 'f1',
    picks: { s1: 'must' },
    festival: { stages: [], days: [{ label: 'Sat', sets: [{ id: 's1', extra: 1 }] }], b2bSeparator: null },
  };

  it('builds the json url', () => {
    expect(sharedPicksJsonUrl('t', 'https://festie.us/api/v1')).toBe('https://festie.us/s/t/json');
    expect(sharedPicksJsonUrl('t', '/api/v1')).toBe('/s/t/json');
  });

  it('returns a valid payload and keeps extra set fields', async () => {
    fetchMock.mockResolvedValue(res({ data: payload, error: null }));
    const r = await fetchSharedPicks('t');
    expect(fetchMock.mock.calls[0]![0]).toBe('/s/t/json');
    expect((r.festival.days[0]!.sets[0] as unknown as { extra: number }).extra).toBe(1);
  });

  it('throws ApiClientError 404 from the error envelope', async () => {
    fetchMock.mockResolvedValue(res({ data: null, error: { message: 'gone', code: 'NOT_FOUND' } }, 404));
    await expect(fetchSharedPicks('t')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'gone' });
    await expect(fetchSharedPicks('t')).rejects.toBeInstanceOf(ApiClientError);
  });

  it('throws INVALID_INPUT for a payload with no picks', async () => {
    const { picks: _picks, ...bad } = payload;
    fetchMock.mockResolvedValue(res({ data: bad, error: null }));
    await expect(fetchSharedPicks('t')).rejects.toMatchObject({ status: 0, code: 'INVALID_INPUT' });
  });

  it('fetchPrintableSchedule asks for text', async () => {
    get.mockResolvedValue('<html/>');
    expect(await fetchPrintableSchedule('f1', 'p1')).toBe('<html/>');
    expect(get).toHaveBeenCalledWith('/export/f1/p1', { asText: true });
  });
});
