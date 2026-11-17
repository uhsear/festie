import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const state: Record<string, unknown> = {};
const NOW = Date.UTC(2099, 0, 20, 12);

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state),
}));
vi.mock('../../hooks/useSetStatus', () => ({ useNow: () => NOW }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: { to: string; params: { setId: string }; children: React.ReactNode }) => (
    <a href={to.replace('$setId', params.setId)} {...rest}>
      {children}
    </a>
  ),
}));

import AnnouncedLineup from './AnnouncedLineup';

const entry = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  artists: [{ name }],
  displayName: null,
  tier: null,
  dayDate: null,
  status: 'announced',
  announcedAt: '2098-12-01',
  linkedSetIds: [],
  ...extra,
});
const day = (date: string, label: string) => ({ id: label, festivalId: 'f', date, label, createdAt: '', updatedAt: '' });
const set = (id: string, artist: string, dayIndex: number, startTime = '') => ({
  id,
  festivalId: 'f',
  stageId: 'main',
  artist,
  dayIndex,
  startTime,
  endTime: '',
  createdAt: '',
  updatedAt: '',
});

function setFestival(lineup: unknown[], sets: unknown[] = [], extra: Record<string, unknown> = {}) {
  Object.assign(state, {
    currentFestival: {
      id: 'f',
      name: 'Names Fest',
      b2bSeparator: 'b2b',
      publishedAt: '2098-12-15T00:00:00.000Z',
      startDate: '2099-02-05',
      endDate: '2099-02-06',
      lineup,
      ...extra,
    },
    days: [day('2099-02-05', 'Fri'), day('2099-02-06', 'Sat')],
    sets,
    stages: [{ id: 'main', name: 'Main Stage' }],
    selectedDay: 0,
    searchQuery: '',
  });
}

const names = (container: HTMLElement) => [...container.querySelectorAll('li')].map((li) => li.firstElementChild?.textContent);

describe('AnnouncedLineup', () => {
  beforeEach(() => {
    window.localStorage.clear();
    for (const key of Object.keys(state)) delete state[key];
  });

  it('renders nothing for a festival with no announced acts, or one that is over', () => {
    setFestival([]);
    const { container, rerender } = render(<AnnouncedLineup />);
    expect(container).toBeEmptyDOMElement();
    setFestival([entry('1', 'A')], [], { startDate: '2098-01-01', endDate: '2098-01-02' });
    state.days = [day('2098-01-01', 'Fri')];
    rerender(<AnnouncedLineup />);
    expect(container).toBeEmptyDOMElement();
  });

  it('with no sets: counts the acts, says set times are not out, and lists the poster by tier', () => {
    setFestival([
      entry('1', 'Low Act', { tier: 3 }),
      entry('2', 'Top Act', { tier: 1 }),
      entry('3', 'Loose Act'),
      entry('4', 'Gone Act', { status: 'cancelled' }),
    ]);
    const { container } = render(<AnnouncedLineup />);
    expect(screen.getByText('3 acts announced · Set times TBA')).toBeInTheDocument();
    expect(screen.getByText("Set times aren't out yet.")).toBeInTheDocument();
    expect(names(container)).toEqual(['Top Act', 'Low Act', 'Loose Act', 'Gone Act']);
    expect(screen.getAllByText('Day TBA')).toHaveLength(3);
    expect(screen.getByText('Gone Act')).toHaveClass('line-through');
    expect(screen.getByRole('heading', { name: 'Cancelled' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Full lineup' })).not.toBeInTheDocument();
  });

  it('switches to A-Z with letter headings and remembers the choice on the device', async () => {
    setFestival([entry('1', 'Zeds Dead'), entry('2', 'The Alpha'), entry('3', 'Bacardi')]);
    const { container } = render(<AnnouncedLineup />);
    expect(screen.getByRole('button', { name: 'Poster' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'A-Z' }));
    expect([...container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['A', 'B', 'Z']);
    expect(window.localStorage.getItem('festie.lineupView')).toBe('az');
  });

  it("follows the selected day: that day's acts first, then the Day TBA acts", () => {
    setFestival([
      entry('1', 'Day TBA Act'),
      entry('2', 'Friday Act', { dayDate: '2099-02-05' }),
      entry('3', 'Saturday Act', { dayDate: '2099-02-06' }),
    ]);
    const { container, rerender } = render(<AnnouncedLineup />);
    expect(names(container)).toEqual(['Friday Act', 'Day TBA Act']);
    expect(screen.getByText('Fri · Stage and time TBA')).toBeInTheDocument();
    state.selectedDay = 1;
    rerender(<AnnouncedLineup />);
    expect(names(container)).toEqual(['Saturday Act', 'Day TBA Act']);
  });

  it('with some sets: leaves covered acts out of the default list and brings them back under "Full lineup"', async () => {
    setFestival(
      [entry('1', 'Covered Act'), entry('2', 'Open Act', { dayDate: '2099-02-05' }), entry('3', 'Untimed Act')],
      [set('s1', 'Covered Act', 0, '20:00'), set('s2', 'Untimed Act', 0)],
    );
    const { container } = render(<AnnouncedLineup />);
    expect(screen.getByText('2 of 3 acts are on the timetable')).toBeInTheDocument();
    expect(names(container)).toEqual(['Open Act']);
    expect(screen.getByText('Not on the timetable yet')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Full lineup' }));
    expect(screen.getByRole('button', { name: 'Full lineup' })).toHaveAttribute('aria-pressed', 'true');
    const covered = screen.getByRole('link', { name: /Covered Act/ });
    expect(covered).toHaveAttribute('href', '/set/s1');
    expect(covered).toHaveTextContent('Fri · 8:00 PM · Main Stage');
    expect(screen.getByRole('link', { name: /Untimed Act/ })).toHaveTextContent('Fri · Main Stage · Time TBA');
  });

  it('says every act is on the timetable when none is left to list', () => {
    setFestival([entry('1', 'Covered Act')], [set('s1', 'Covered Act', 0, '20:00')]);
    render(<AnnouncedLineup />);
    expect(screen.getByText('1 of 1 act are on the timetable')).toBeInTheDocument();
    expect(screen.getByText(/Every announced act for this day is on the timetable/)).toBeInTheDocument();
  });

  it('marks an act announced after publish as New', () => {
    setFestival([entry('1', 'Fresh Act', { announcedAt: '2099-01-10' }), entry('2', 'Draft Act', { announcedAt: '2098-12-10' })]);
    render(<AnnouncedLineup />);
    const fresh = screen.getByText('Fresh Act').closest('li')!;
    expect(within(fresh).getByText('New')).toBeInTheDocument();
    expect(within(screen.getByText('Draft Act').closest('li')!).queryByText('New')).not.toBeInTheDocument();
  });

  it('a search shows only the matching acts that have no set, under "Announced acts", on every day', () => {
    setFestival(
      [
        entry('1', 'Alpha'),
        entry('2', 'Alpine', { dayDate: '2099-02-06' }),
        entry('3', 'Alps'),
        entry('4', 'Beta'),
      ],
      [set('s1', 'Alps', 0, '20:00')],
    );
    state.searchQuery = 'al';
    const { container } = render(<AnnouncedLineup />);
    expect(screen.getByRole('heading', { name: 'Announced acts' })).toBeInTheDocument();
    expect(names(container)).toEqual(['Alpha', 'Alpine']);
    expect(screen.queryByText(/acts announced/)).not.toBeInTheDocument();
  });

  it('shows nothing for a search that matches no announced act', () => {
    setFestival([entry('1', 'Alpha')]);
    state.searchQuery = 'zzz';
    const { container } = render(<AnnouncedLineup />);
    expect(container).toBeEmptyDOMElement();
  });
});
