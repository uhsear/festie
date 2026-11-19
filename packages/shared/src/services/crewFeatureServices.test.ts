import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchCrewPolls } from './crewPolls';
import { fetchCrewExpenses, fetchCrewSettlementPlan } from './crewExpenses';
import { fetchMeetingPoints } from './meetingPoints';
import { fetchFestivalRatings, rateSet } from './ratings';
import { api } from './api';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

describe('crew feature services', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('accepts a bare array or a wrapped meeting point list', async () => {
    vi.mocked(api.get).mockResolvedValueOnce([{ id: 'm1' }]).mockResolvedValueOnce({ meetingPoints: [{ id: 'm2' }] });
    await expect(fetchMeetingPoints('c')).resolves.toEqual([{ id: 'm1' }]);
    await expect(fetchMeetingPoints('c')).resolves.toEqual([{ id: 'm2' }]);
    expect(api.get).toHaveBeenCalledWith('/crews/c/meeting-points');
  });

  it('drops malformed poll votes', async () => {
    const good = { user_id: 'u', option: 0 };
    vi.mocked(api.get).mockResolvedValueOnce({ polls: [{ id: 'p', votes: [good, { user_id: 'u' }, null] }] });
    await expect(fetchCrewPolls('c')).resolves.toEqual([{ id: 'p', votes: [good] }]);
  });

  it('defaults empty expense and settlement responses', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    await expect(fetchCrewExpenses('c')).resolves.toEqual([]);
    await expect(fetchCrewSettlementPlan('c')).resolves.toEqual({ balances: [], settlements: [], currency: undefined });
  });

  it('unwraps festival ratings and posts with a deterministic clientId', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ ratings: [{ setId: 's', rating: 4 }] });
    await expect(fetchFestivalRatings('f')).resolves.toEqual([{ setId: 's', rating: 4 }]);
    await rateSet('s', 5);
    expect(api.post).toHaveBeenCalledWith('/ratings/s', { rating: 5 }, { clientId: 'rate-s' });
  });
});
