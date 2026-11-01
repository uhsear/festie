import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const festivalState: Record<string, unknown> = {};
const uiState: Record<string, unknown> = {};

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
}));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(uiState)),
}));

const savePick = vi.fn();
const clearPick = vi.fn();
const picksApi = {
  getMyPick: vi.fn((): string | null => 'must'),
  getMyNote: vi.fn((): string => ''),
  getMyReminder: vi.fn((): number | undefined => undefined),
  savePick,
};
vi.mock('@festie/shared/hooks', () => ({
  usePicks: () => picksApi,
  useFestival: () => ({ getStageColor: () => '#ccc', getStageName: () => 'Main Stage' }),
  usePickClear: () => clearPick,
}));

vi.mock('../../lib/useUndoNotifier', () => ({ useUndoNotifier: () => ({}) }));
const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('../ui/StageBadge', () => ({
  default: ({ stageName }: { stageName: string }) => <span data-testid="stage-badge">{stageName}</span>,
}));

import PicksPlanRow from './PicksPlanRow';

const set = {
  id: 's1',
  festivalId: 'f1',
  stageId: 'st1',
  artist: 'Odesza',
  startTime: '14:00',
  endTime: '15:00',
  dayIndex: 0,
  createdAt: '',
  updatedAt: '',
} as never;

describe('PicksPlanRow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(festivalState).forEach((k) => delete festivalState[k]);
    Object.assign(festivalState, { currentFestival: { id: 'f1', name: 'Bonnaroo' } });
    Object.keys(uiState).forEach((k) => delete uiState[k]);
    Object.assign(uiState, { setDetailSet: vi.fn() });
    picksApi.getMyPick.mockReturnValue('must');
    picksApi.getMyNote.mockReturnValue('');
    picksApi.getMyReminder.mockReturnValue(undefined);
  });

  it('shows note, reminder and clash markers with screen-reader text', () => {
    picksApi.getMyNote.mockReturnValue('meet at the rail');
    picksApi.getMyReminder.mockReturnValue(15);
    render(<PicksPlanRow set={set} hasClash />);
    expect(screen.getByText('Has note')).toBeInTheDocument();
    expect(screen.getByText('Reminder 15 minutes before')).toBeInTheDocument();
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getByText('Clash')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Odesza, .*, Main Stage, has note, reminder 15 minutes before, clash$/ }),
    ).toBeInTheDocument();
  });

  it('shows no marker line when there is nothing to mark', () => {
    render(<PicksPlanRow set={set} hasClash={false} />);
    expect(screen.queryByText('Has note')).toBeNull();
    expect(screen.queryByText('Clash')).toBeNull();
  });

  it('saves a new priority when an inactive one is tapped', () => {
    savePick.mockResolvedValue(undefined);
    render(<PicksPlanRow set={set} hasClash={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Maybe' }));
    expect(savePick).toHaveBeenCalledWith('f1', 's1', 'maybe');
    expect(clearPick).not.toHaveBeenCalled();
  });

  it('clears with undo when the active priority is tapped', () => {
    render(<PicksPlanRow set={set} hasClash={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Must See' }));
    expect(clearPick).toHaveBeenCalledWith('s1', 'Odesza');
    expect(savePick).not.toHaveBeenCalled();
  });

  it('opens the set panel from the main button', () => {
    render(<PicksPlanRow set={set} hasClash={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Odesza,/ }));
    expect(uiState.setDetailSet).toHaveBeenCalledWith(set);
  });
});
