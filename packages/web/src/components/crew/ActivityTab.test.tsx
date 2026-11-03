import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@festie/shared', async () => {
  const actual = await vi.importActual<typeof import('@festie/shared')>('@festie/shared');
  return { ...actual, api: { ...actual.api, get: apiGet } };
});

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

import ActivityTab from './ActivityTab';

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivityTab crewId="c1" />
    </QueryClientProvider>,
  );
}

const row = (id: string, type: string, detail: string | null = null) => ({
  id,
  crew_id: 'c1',
  user_id: 'u1',
  username: 'sam',
  type,
  detail,
  created_at: new Date().toISOString(),
});

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

  it('hides poll-voted rows', async () => {
    apiGet.mockResolvedValue({ items: [row('a1', 'poll-voted'), row('a2', 'expense-settled', '$12.00 to Sam')], nextCursor: null });
    renderTab();
    expect(await screen.findByText(/\$12\.00 to Sam/)).toBeInTheDocument();
    expect(screen.getAllByText('sam', { selector: 'span.font-semibold' })).toHaveLength(1);
  });

  it('Show older requests ?cursor= and appends the next page', async () => {
    apiGet.mockReset();
    apiGet
      .mockResolvedValueOnce({ items: [row('a1', 'expense-settled', '$1.00 to Sam')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [row('a2', 'expense-settled', '$2.00 to Sam')], nextCursor: null });
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }));
    expect(await screen.findByText(/\$2\.00 to Sam/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenLastCalledWith('/crews/c1/activity?cursor=c1');
    expect(screen.getByText(/\$1\.00 to Sam/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
  });
});
