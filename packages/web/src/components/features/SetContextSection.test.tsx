import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FestivalSet, Priority } from '@festie/shared/types';

const state = vi.hoisted(() => ({
  ctx: { before: null, after: null, overlaps: [] } as Record<string, unknown>,
  picks: {} as Record<string, Priority>,
}));
const setDetailSet = vi.hoisted(() => vi.fn());

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      stages: [
        { id: 'st1', name: 'Main' },
        { id: 'st2', name: 'Sahara' },
      ],
      currentFestival: { b2bSeparator: undefined },
    }),
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ setDetailSet }),
}));
vi.mock('@festie/shared/hooks', () => ({
  useSetContext: () => state.ctx,
  usePicks: () => ({ getMyPick: (id: string) => state.picks[id] }),
}));

import SetContextSection from './SetContextSection';

const mk = (id: string, artist: string, stageId: string): FestivalSet =>
  ({ id, festivalId: 'f1', stageId, artist }) as FestivalSet;
const me = mk('me', 'Me', 'st1');

describe('SetContextSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.ctx = { before: null, after: null, overlaps: [] };
    state.picks = {};
  });

  it('renders nothing when there is no context', () => {
    const { container } = render(<SetContextSection set={me} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows only the neighbours section when nothing overlaps', () => {
    state.ctx = { before: { set: mk('p', 'Prev', 'st1'), time: '6:00 PM - 7:00 PM' }, after: null, overlaps: [] };
    render(<SetContextSection set={me} />);
    expect(screen.getByText('On Main that night')).toBeInTheDocument();
    expect(screen.queryByText('Playing at the same time')).toBeNull();
  });

  it('lists overlaps with stage and time, marks a picked one, and opens it on click', async () => {
    const user = userEvent.setup();
    state.picks = { o: 'must' };
    state.ctx = { before: null, after: null, overlaps: [{ set: mk('o', 'Odesza', 'st2'), time: '8:30 PM - 9:30 PM' }] };
    render(<SetContextSection set={me} />);
    expect(screen.queryByText('On Main that night')).toBeNull();
    expect(screen.getByText('Sahara · 8:30 PM - 9:30 PM')).toBeInTheDocument();
    expect(screen.getByText('Must See')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Odesza, Sahara/ }));
    expect(setDetailSet).toHaveBeenCalledWith(expect.objectContaining({ id: 'o' }));
  });
});
