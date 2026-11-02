import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { normalizeAnalytics } from '@festie/shared/utils';
import AdminAnalytics from './AdminAnalytics';

const setAdminSearch = vi.fn();
let searchState: { festival?: string } = {};
vi.mock('./useAdminSearch', () => ({ useAdminSearch: () => [searchState, setAdminSearch] }));

const mockFetch = vi.fn();
const mockInsight = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAdminAnalytics: (...a: unknown[]) => mockFetch(...a),
  fetchAdminPickInsight: (...a: unknown[]) => mockInsight(...a),
}));

const data = normalizeAnalytics({
  scope: { festivalId: null, festivalName: null },
  totals: { signedUp: 10, usersWithPlan: 8, plans: 9, plansWithPicks: 6, usersWithPick: 4, picks: 30, crews: 2, crewMembers: 5, usersInCrews: 5, crewsWithTwoPlus: 2 },
  pickDistribution: { must: 10, want: 15, maybe: 5 },
  install: { days: 30, shown: 0, accepted: 0, dismissed: 0 },
  festivalStats: [{ id: 'f1', name: 'Forbidden Kingdom', profileCount: 8, uniqueSetsPicked: 12, totalPicks: 30 }],
  generatedAt: '2026-11-01T00:00:00Z',
});

function renderAnalytics() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminAnalytics />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  searchState = {};
  mockFetch.mockResolvedValue(data);
  mockInsight.mockResolvedValue({
    festivalId: 'f1',
    festivalName: 'Forbidden Kingdom',
    minPairPeople: 5,
    sets: [],
    clashes: [],
    generatedAt: '2026-11-02T00:00:00Z',
  });
});

describe('AdminAnalytics', () => {
  it('renders the questions, funnel and true pick total', async () => {
    renderAnalytics();
    expect(await screen.findByText('How many people picked at least one set?')).toBeInTheDocument();
    expect(screen.getByText('4 of 8 people with a plan (50%).')).toBeInTheDocument();
    expect(screen.getByText('Where do people drop off?')).toBeInTheDocument();
    expect(screen.getByText('Pick priority across all 30 picks')).toBeInTheDocument();
  });

  it('without a festival it asks for one and makes no insight request', async () => {
    renderAnalytics();
    expect(
      await screen.findByText('Choose a festival to see clashing picks and export picks per set.'),
    ).toBeInTheDocument();
    expect(mockInsight).not.toHaveBeenCalled();
  });

  it('with a festival it shows Clashing picks and requests that festival', async () => {
    searchState = { festival: 'f1' };
    renderAnalytics();
    expect(await screen.findByText('Clashing picks')).toBeInTheDocument();
    expect(mockInsight).toHaveBeenCalledWith('f1');
  });

  it('an error shows Retry and no zeros', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    renderAnalytics();
    expect(await screen.findByText("Couldn't load analytics")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText(/0\.0/)).not.toBeInTheDocument();
  });

  it('choosing a festival puts it in the URL', async () => {
    renderAnalytics();
    await userEvent.selectOptions(await screen.findByLabelText('Festival'), 'f1');
    expect(setAdminSearch).toHaveBeenCalledWith({ tab: 'analytics', festival: 'f1' });
  });
});
