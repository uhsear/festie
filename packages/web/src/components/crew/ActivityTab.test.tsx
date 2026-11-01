import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@festie/shared', async () => {
  const actual = await vi.importActual<typeof import('@festie/shared')>('@festie/shared');
  return { ...actual, api: { ...actual.api, get: apiGet } };
});

import ActivityTab from './ActivityTab';

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivityTab crewId="c1" />
    </QueryClientProvider>,
  );
}

describe('ActivityTab', () => {
  it('renders entries from the { items, nextCursor } page the server returns', async () => {
    apiGet.mockResolvedValue({
      items: [
        {
          id: 'a1',
          crew_id: 'c1',
          user_id: 'u1',
          username: 'sam',
          type: 'expense-settled',
          detail: '$12.00 to Alex',
          created_at: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    });
    renderTab();
    expect(await screen.findByText('sam', { selector: 'span.font-semibold' })).toBeInTheDocument();
    expect(screen.getByText(/settled up/)).toBeInTheDocument();
  });

  it('shows the empty state when items is empty', async () => {
    apiGet.mockResolvedValue({ items: [], nextCursor: null });
    renderTab();
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });
});
