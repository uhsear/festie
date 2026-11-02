import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CompareSummary from './CompareSummary';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const columns = [
  { profileId: 'p1', name: 'Alice', isMe: true, color: 'rgb(1, 2, 3)' },
  { profileId: 'p2', name: 'Bob', isMe: false, color: 'rgb(4, 5, 6)' },
];
const TZ = 'UTC';
const at = (h: number, m = 0) => Date.UTC(2026, 5, 6, h, m);
const set = (id: string, artist: string) => ({ id, artist }) as never;

describe('CompareSummary', () => {
  it('lists one key item per column, with "You" for the current user', () => {
    render(<CompareSummary columns={columns} freeTogether={[]} split={[]} together={[]} timeZone={TZ} />);
    const items = within(screen.getByRole('list', { name: 'Crew colour key' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('You');
    expect(items[1]).toHaveTextContent('Bob');
  });

  it('formats free-together chips', () => {
    render(
      <CompareSummary
        columns={columns}
        freeTogether={[
          { startMs: at(18), endMs: at(19), minutes: 60 },
          { startMs: at(20), endMs: at(21, 30), minutes: 90 },
        ]}
        split={[]}
        together={[]}
        timeZone={TZ}
      />,
    );
    expect(screen.getByText('Free together')).toBeInTheDocument();
    expect(screen.getByText('Nobody in the crew has a pick then.')).toBeInTheDocument();
    expect(screen.getByText(/6:00 PM – 7:00 PM · 1 h/)).toBeInTheDocument();
    expect(screen.getByText(/8:00 PM – 9:30 PM · 1 h 30 min/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add meeting point' })).toBeInTheDocument();
  });

  it('hides the free-together strip when there are no slots', () => {
    render(<CompareSummary columns={columns} freeTogether={[]} split={[]} together={[]} timeZone={TZ} />);
    expect(screen.queryByText('Free together')).not.toBeInTheDocument();
    expect(screen.queryByText('Split')).not.toBeInTheDocument();
    expect(screen.queryByText('Together')).not.toBeInTheDocument();
  });

  it('shows who goes where in a split, and the together sets', () => {
    render(
      <CompareSummary
        columns={columns}
        freeTogether={[]}
        split={[
          {
            startMs: at(20),
            endMs: at(21, 30),
            sides: [
              { set: set('a', 'Ana Set'), memberIds: ['p1'] },
              { set: set('b', 'Bea Set'), memberIds: ['p2'] },
            ],
          },
        ]}
        together={[{ set: set('c', 'Cal Set'), startMs: at(22), memberIds: ['p1', 'p2'] }]}
        timeZone={TZ}
      />,
    );
    expect(screen.getByText('8:00 PM – 9:30 PM')).toBeInTheDocument();
    expect(screen.getByText('Ana Set: You')).toBeInTheDocument();
    expect(screen.getByText('Bea Set: Bob')).toBeInTheDocument();
    expect(screen.getByText('Together')).toBeInTheDocument();
    expect(screen.getByText(/10:00 PM · You, Bob/)).toBeInTheDocument();
  });
});
