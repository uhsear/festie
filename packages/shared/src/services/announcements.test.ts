import { describe, it, expect, beforeEach, vi } from 'vitest';
import { announcementsApi } from './announcements';
import { api } from './api';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

describe('announcementsApi', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  it('list gets the encoded public route', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([]);
    await expect(announcementsApi.list('f/1')).resolves.toEqual([]);
    expect(api.get).toHaveBeenCalledWith('/festivals/f%2F1/announcements');
  });

  it('adminList gets the encoded admin route', async () => {
    const data = { festivalName: 'F', recipients: 2, announcements: [] };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    await expect(announcementsApi.adminList('f 1')).resolves.toBe(data);
    expect(api.get).toHaveBeenCalledWith('/admin/festivals/f%201/announcements');
  });

  it('create posts the body to the admin route', async () => {
    const body = { severity: 'info', title: 't', body: 'b', screen: 'home', sendAt: '2026-01-01T00:00:00Z' } as never;
    vi.mocked(api.post).mockResolvedValueOnce({ recipients: 3 });
    await expect(announcementsApi.create('f1', body)).resolves.toEqual({ recipients: 3 });
    expect(api.post).toHaveBeenCalledWith('/admin/festivals/f1/announcements', body);
  });

  it('cancel deletes by encoded festival and announcement id', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({});
    await announcementsApi.cancel('f/1', 'a/2');
    expect(api.delete).toHaveBeenCalledWith('/admin/festivals/f%2F1/announcements/a%2F2');
  });

  it('every admin call takes the manage scope for an organization owner', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({});
    vi.mocked(api.post).mockResolvedValueOnce({});
    vi.mocked(api.delete).mockResolvedValueOnce({});
    await announcementsApi.adminList('f1', 'manage');
    await announcementsApi.create('f1', { title: 't' } as never, 'manage');
    await announcementsApi.cancel('f1', 'a1', 'manage');
    expect(api.get).toHaveBeenCalledWith('/manage/festivals/f1/announcements');
    expect(api.post).toHaveBeenCalledWith('/manage/festivals/f1/announcements', { title: 't' });
    expect(api.delete).toHaveBeenCalledWith('/manage/festivals/f1/announcements/a1');
  });
});
