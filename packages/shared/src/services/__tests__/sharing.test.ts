import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));

import { api } from '../api';
import { fetchShareLink, fetchCalendarLinks, fetchSharingStatus, resetShareLinks } from '../sharing';

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
