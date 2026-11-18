import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const state: Record<string, unknown> = {};
const rows: unknown[] = [];

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
}));
vi.mock('@festie/shared/hooks/useInterest', () => ({ useInterestedRows: () => rows }));
vi.mock('../../hooks/useSetStatus', () => ({ useNow: () => Date.UTC(2099, 0, 20, 12) }));

import MarkedNoSet from './MarkedNoSet';

const row = (id: string, name: string, status: string, dayIndex = -1) => ({
  entry: {
    id,
    artists: [{ name }],
    displayName: null,
    tier: null,
    dayDate: null,
    status: 'announced',
    announcedAt: '2098-12-01',
    linkedSetIds: [],
  },
  mark: { state: 'open' },
  cover: { setIds: [], state: 'announced', dayIndex },
  status,
  pickedWhen: null,
  addSetIds: [],
});

describe('MarkedNoSet', () => {
  beforeEach(() => {
    rows.length = 0;
    Object.assign(state, {
      currentFestival: { id: 'f', b2bSeparator: 'b2b', publishedAt: '2098-12-15T00:00:00.000Z' },
      days: [{ date: '2099-02-05', label: 'Fri' }],
      sets: [],
    });
  });

  it('hides when nothing is marked', () => {
    const { container } = render(<MarkedNoSet />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists only open marks that no set covers, each with the lineup badge', () => {
    rows.push(row('1', 'Wait Act', 'waiting'), row('2', 'Covered Act', 'has-set'), row('3', 'Day Act', 'waiting', 0));
    render(<MarkedNoSet />);
    expect(screen.getByRole('heading', { name: 'Marked, no set yet' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.firstElementChild?.textContent)).toEqual(['Wait Act', 'Day Act']);
    expect(within(items[0]!).getByText('Day TBA')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Fri · Stage and time TBA')).toBeInTheDocument();
  });
});
