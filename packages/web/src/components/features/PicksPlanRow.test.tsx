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
const moveMock = vi.hoisted(() => ({ value: null as null | { chip: string; line: string; a11y: string } }));
const picksApi = {
  getMyPick: vi.fn((_id: string): string | null => 'must'),
  getMyNote: vi.fn((_id: string): string => ''),
  getMyReminder: vi.fn((_id: string): number | undefined => undefined),
  savePick,
};
vi.mock('@festie/shared/hooks', () => ({
  useMyPick: (id: string) => picksApi.getMyPick(id),
  useMyNote: (id: string) => picksApi.getMyNote(id),
  useMyReminder: (id: string) => picksApi.getMyReminder(id),
  usePickActions: () => ({ savePick: picksApi.savePick }),
  usePickClear: () => clearPick,
  useSetMove: () => moveMock.value,
}));

vi.mock('../../hooks/useUndoNotifier', () => ({ useUndoNotifier: () => ({}) }));
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
    moveMock.value = null;
    Object.keys(festivalState).forEach((k) => delete festivalState[k]);
    Object.assign(festivalState, {
      currentFestival: { id: 'f1', name: 'Bonnaroo' },
      stages: [{ id: 'st1', name: 'Main Stage', color: '#ccc' }],
    });
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

  it('marks a clash with one hatch and one minutes numeral, no triangle', () => {
    const { container } = render(<PicksPlanRow set={set} hasClash clashMin={30} />);
    expect(container.querySelectorAll('[data-clash-hatch]')).toHaveLength(1);
    expect(container.querySelector('[data-clash-minutes]')!.textContent).toBe('30m');
    expect(container.querySelector('svg.lucide-triangle-alert')).toBeNull();
  });

  it('shows the moved chip and the old slot in the accessible name', () => {
    moveMock.value = { chip: 'Moved', line: 'Moved from Sat 10:00 PM, Sahara', a11y: 'Moved from Saturday 10:00 PM, Sahara' };
    render(<PicksPlanRow set={set} hasClash={false} />);
    expect(screen.getByTestId('set-moved-chip')).toHaveTextContent('Moved');
    expect(
      screen.getByRole('button', { name: /^Odesza, .*, Main Stage, Moved from Saturday 10:00 PM, Sahara$/ }),
    ).toBeInTheDocument();
  });

  it('hides the moved chip when the set has no fresh move', () => {
    render(<PicksPlanRow set={set} hasClash={false} />);
    expect(screen.queryByTestId('set-moved-chip')).toBeNull();
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

  // jsdom has no layout, so this pins the classes that give the name its own full-width line on a phone.
  it('keeps the artist name on its own line on phones, with time and stage wrapped under it', () => {
    render(<PicksPlanRow set={set} hasClash={false} />);
    const nameBlock = screen.getByText('Odesza').closest('.order-1');
    const meta = screen.getByTestId('stage-badge').parentElement;
    expect(nameBlock).not.toBeNull();
    expect(nameBlock?.parentElement?.className).toContain('flex-col');
    expect(nameBlock?.className).toContain('min-w-0');
    expect(meta).not.toBe(nameBlock?.parentElement);
    expect(meta?.className).toContain('flex-wrap');
    expect(meta?.className).toContain('sm:contents');
  });

  it('opens the set panel from the main button', () => {
    render(<PicksPlanRow set={set} hasClash={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Odesza,/ }));
    expect(uiState.setDetailSet).toHaveBeenCalledWith(set);
  });
});
