import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { InboxItem } from '@festie/shared/stores/inboxStore';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const order: string[] = [];
const load = vi.fn(async () => {
  order.push('load');
});
const markAllSeen = vi.fn(async () => {
  order.push('markAllSeen');
});
let state: Record<string, unknown> = {};
vi.mock('@festie/shared/stores/inboxStore', async (orig) => {
  const actual = await orig<typeof import('@festie/shared/stores/inboxStore')>();
  const useInboxStore = Object.assign(() => state, { getState: () => state });
  return { ...actual, useInboxStore };
});
vi.mock('@festie/shared/stores', () => ({
  useCrewStore: { getState: () => ({ activeCrew: null, selectCrew: vi.fn() }) },
  useFestivalStore: { getState: () => ({ festivals: [], loadFestivals: vi.fn(), selectFestival: vi.fn() }) },
}));

import InboxView from './inbox';

const items: InboxItem[] = [
  {
    id: 'a',
    type: 'set_reminder',
    title: 'Set soon',
    body: 'Starts in 15',
    createdAt: '2026-11-02T10:00:00.000Z',
    data: { setId: 's1' },
  },
  { id: 'b', type: 'crew_news', title: 'Crew news', body: 'Hello', createdAt: '2026-11-01T10:00:00.000Z', data: {} },
];

function setState(over: Record<string, unknown>) {
  state = {
    items,
    seenAt: '2026-11-02T00:00:00.000Z',
    loaded: true,
    loading: false,
    error: null,
    load,
    markAllSeen,
    ...over,
  };
}

describe('InboxView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    setState({});
  });

  it('renders rows, marks the unread one, and marks all seen after load', async () => {
    render(<InboxView />);
    expect(screen.getByRole('button', { name: /Set soon\. Starts in 15\. .* Unread\./ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Crew news\. Hello\. [^.]*\.$/ })).toBeTruthy();
    await waitFor(() => expect(order).toEqual(['load', 'markAllSeen']));
  });

  it('opens a set row', () => {
    render(<InboxView />);
    fireEvent.click(screen.getByText('Set soon'));
    expect(navigate).toHaveBeenCalledWith({ to: '/set/s1' });
  });

  it('shows the empty copy', () => {
    setState({ items: [] });
    render(<InboxView />);
    expect(screen.getByText(/No notifications yet/)).toBeTruthy();
  });

  it('shows the error with retry when there are no items', () => {
    setState({ items: [], error: 'x' });
    render(<InboxView />);
    expect(screen.getByText("Couldn't load your notifications.")).toBeTruthy();
    load.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps the list when an error arrives with items', () => {
    setState({ error: 'x' });
    render(<InboxView />);
    expect(screen.getByText("Couldn't load your notifications.")).toBeTruthy();
    expect(screen.getByText('Set soon')).toBeTruthy();
  });
});
