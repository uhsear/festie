import { describe, it, expect, beforeEach, vi } from 'vitest';
import { timeReleaseApi } from './timeReleases';
import { api } from './api';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe('timeReleaseApi', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('panel gets the encoded time-releases route', async () => {
    const data = { dates: [] };
    vi.mocked(api.get).mockResolvedValueOnce(data);
    await expect(timeReleaseApi.panel('f/1')).resolves.toBe(data);
    expect(api.get).toHaveBeenCalledWith('/admin/festivals/f%2F1/time-releases');
  });

  it('send posts the body to the same route', async () => {
    const body = { dates: ['2026-01-01'] } as never;
    vi.mocked(api.post).mockResolvedValueOnce({ released: 1 });
    await expect(timeReleaseApi.send('f1', body)).resolves.toEqual({ released: 1 });
    expect(api.post).toHaveBeenCalledWith('/admin/festivals/f1/time-releases', body);
  });
});
