import { describe, it, expect, beforeEach, vi } from 'vitest';
import { markCaught } from './caught';
import { api } from './api';

vi.mock('./api', () => ({ api: { put: vi.fn() } }));

describe('markCaught', () => {
  beforeEach(() => {
    vi.mocked(api.put).mockReset();
  });

  it.each([true, false, null])('puts caught=%s with a deterministic clientId', async (caught) => {
    vi.mocked(api.put).mockResolvedValueOnce({ ok: true });
    await expect(markCaught('s1', caught, 'u1')).resolves.toEqual({ ok: true });
    expect(api.put).toHaveBeenCalledWith(
      '/ratings/s1/caught',
      { caught },
      { clientId: 'caught-u1-s1', offlineLabel: 'Mark a set as seen' },
    );
  });
});
