import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminGrowth from './AdminGrowth';

const mockFetch = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({ fetchAdminGrowth: (...a: unknown[]) => mockFetch(...a) }));

function renderGrowth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminGrowth />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('AdminGrowth', () => {
  it('shows sign-ups by source and followers per festival', async () => {
    mockFetch.mockResolvedValue({
      days: 30,
      signupsByRef: [{ day: '2026-11-01', ref: 'share-festival', signups: 3 }],
      followsPerDay: [],
      followers: [{ festivalId: 'f1', festivalName: 'Fest One', followers: 12 }],
      newsSends: [],
      newsHeld: [{ day: '2026-11-01', type: 'lineup_drop', count: 2 }],
      generatedAt: '2026-11-02T00:00:00Z',
    });
    renderGrowth();
    expect(await screen.findByText('Growth, last 30 days')).toBeInTheDocument();
    expect(screen.getByText('share-festival')).toBeInTheDocument();
    expect(screen.getByText('Fest One')).toBeInTheDocument();
    expect(screen.getByText('lineup_drop')).toBeInTheDocument();
    expect(screen.getByText('No news pushes sent.')).toBeInTheDocument();
  });

  it('says so when the report fails to load', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    renderGrowth();
    expect(await screen.findByText(/Couldn't load growth/)).toBeInTheDocument();
  });
});
