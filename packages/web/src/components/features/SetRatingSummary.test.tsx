import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SetRatingSummary from './SetRatingSummary';

const h = vi.hoisted(() => ({
  fetchCrowdRatings: vi.fn(),
  fetchCrewRatings: vi.fn(),
  crew: { id: 'c1', festivalId: 'f1' } as { id: string; festivalId: string } | null,
}));

vi.mock('@festie/shared/services', () => ({
  fetchCrowdRatings: h.fetchCrowdRatings,
  fetchCrewRatings: h.fetchCrewRatings,
}));
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'me' } }),
}));
vi.mock('@festie/shared/stores/crewStore', () => ({
  useCrewStore: (sel: (s: unknown) => unknown) => sel({ activeCrew: h.crew }),
}));

const crowd = new Map([['s1', { avg: 4.6, count: 5 }]]);
const crew = new Map([['s1', [{ userId: 'u2', username: 'Sam', rating: 4 }]]]);

describe('SetRatingSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.crew = { id: 'c1', festivalId: 'f1' };
    h.fetchCrowdRatings.mockResolvedValue(crowd);
    h.fetchCrewRatings.mockResolvedValue(crew);
  });

  it('renders crowd and crew lines', async () => {
    render(<SetRatingSummary setId="s1" festivalId="f1" />);
    expect(
      await screen.findByText('Crowd favourite · 4.6 out of 5 from 5 ratings'),
    ).toBeInTheDocument();
    expect(screen.getByText('Your crew: Sam (Good)')).toBeInTheDocument();
  });

  it('hides only the crowd line when the crowd fetch rejects', async () => {
    h.fetchCrowdRatings.mockRejectedValue(new Error('boom'));
    render(<SetRatingSummary setId="s1" festivalId="f1" />);
    expect(await screen.findByText('Your crew: Sam (Good)')).toBeInTheDocument();
    expect(screen.queryByText(/Crowd/)).toBeNull();
  });

  it('skips the crew fetch when the active crew is for another festival', async () => {
    h.crew = { id: 'c1', festivalId: 'other' };
    render(<SetRatingSummary setId="s1" festivalId="f1" />);
    await screen.findByText(/Crowd favourite/);
    expect(h.fetchCrewRatings).not.toHaveBeenCalled();
  });
});
