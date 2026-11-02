import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FestivalSet, Priority } from '@festie/shared/types';

const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toastError }) }));
vi.mock('../../hooks/useSetStatus', () => ({ useNow: () => 0 }));

const state = vi.hoisted(() => ({
  slots: [] as unknown[],
  picks: {} as Record<string, Priority>,
  canPick: true,
}));
const savePick = vi.hoisted(() => vi.fn());
const setDetailSet = vi.hoisted(() => vi.fn());

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      stages: [{ id: 'st2', name: 'Sahara' }],
      currentFestival: { id: 'f1', b2bSeparator: undefined },
    }),
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ setDetailSet }),
}));
vi.mock('@festie/shared/hooks', () => ({
  useAlsoPlays: () => state.slots,
  useCanPick: () => state.canPick,
  usePicks: () => ({ getMyPick: (id: string) => state.picks[id], savePick }),
}));

import AlsoPlaysSection from './AlsoPlaysSection';

const makeSet = (id: string): FestivalSet =>
  ({ id, festivalId: 'f1', stageId: 'st2', artist: 'Odesza', startTime: '21:00' }) as FestivalSet;

const slot = { set: makeSet('s2'), when: 'Sat 9:00 PM', day: 'Sat' };

describe('AlsoPlaysSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.slots = [slot];
    state.picks = { s1: 'must' };
    state.canPick = true;
    savePick.mockResolvedValue(undefined);
  });

  it('renders nothing with no other slot', () => {
    state.slots = [];
    const { container } = render(<AlsoPlaysSection set={makeSet('s1')} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the row text and the stage, and opens the other slot on press', async () => {
    const user = userEvent.setup();
    render(<AlsoPlaysSection set={makeSet('s1')} />);
    expect(screen.getByText('Also plays Sat 9:00 PM')).toBeInTheDocument();
    expect(screen.getByText('Sahara')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Also plays Sat 9:00 PM, Sahara. Open this set.' }));
    expect(setDetailSet).toHaveBeenCalledWith(slot.set);
  });

  it('Pick this one too saves the other slot at the same priority', async () => {
    const user = userEvent.setup();
    render(<AlsoPlaysSection set={makeSet('s1')} />);
    await user.click(screen.getByRole('button', { name: 'Pick Odesza Sat 9:00 PM too' }));
    expect(savePick).toHaveBeenCalledWith('f1', 's2', 'must');
  });

  it('shows the error toast when the save fails', async () => {
    const user = userEvent.setup();
    const err = new Error('boom');
    savePick.mockRejectedValue(err);
    render(<AlsoPlaysSection set={makeSet('s1')} />);
    await user.click(screen.getByRole('button', { name: /^Pick Odesza/ }));
    expect(toastError).toHaveBeenCalledWith(err, "Couldn't save your pick. Try again.");
  });

  it('says In your picks when the other slot is picked, with no button', () => {
    state.picks = { s1: 'must', s2: 'maybe' };
    render(<AlsoPlaysSection set={makeSet('s1')} />);
    expect(screen.getByText('In your picks')).toBeInTheDocument();
    expect(screen.queryByText('Pick this one too')).not.toBeInTheDocument();
  });

  it('offers no button when this set is not picked', () => {
    state.picks = {};
    render(<AlsoPlaysSection set={makeSet('s1')} />);
    expect(screen.queryByText('Pick this one too')).not.toBeInTheDocument();
  });

  it('offers no button when picking is not allowed', () => {
    state.canPick = false;
    render(<AlsoPlaysSection set={makeSet('s1')} />);
    expect(screen.queryByText('Pick this one too')).not.toBeInTheDocument();
  });
});
