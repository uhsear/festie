import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const festivalState: Record<string, unknown> = {};
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ activeCrew: null, crewOverlap: {} }),
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: null }),
}));

const mockFetchPrintable = vi.fn();
vi.mock('@festie/shared/services', () => ({
  fetchPrintableSchedule: (...a: unknown[]) => mockFetchPrintable(...a),
}));

const mockCapture = vi.fn();
vi.mock('../../lib/shareImage', () => ({
  captureAndShareImage: (...a: unknown[]) => mockCapture(...a),
  captureAndShareImages: vi.fn(),
}));

const mockToast = vi.fn();
const mockToastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast, toastError: mockToastError }),
}));

import ScheduleImageDialog from './ScheduleImageDialog';

const set = (id: string, dayIndex: number, startTime: string) => ({
  id,
  artist: `Artist ${id}`,
  stageId: 'st1',
  dayIndex,
  startTime,
  endTime: '23:00',
});

function setup(sets: unknown[], picks: Record<string, string>, initialMode?: 'full', story = true) {
  Object.keys(festivalState).forEach((k) => delete festivalState[k]);
  Object.assign(festivalState, {
    currentFestival: { id: 'f1', name: 'Bonnaroo' },
    currentProfile: { id: 'p1', picks },
    sets,
    stages: [{ id: 'st1', name: 'Main', color: '#00e8d0' }],
    days: [
      { id: 'd0', label: 'Day 1', date: '2026-06-10' },
      { id: 'd1', label: 'Day 2', date: '2026-06-11' },
    ],
    selectedDay: 0,
  });
  render(<ScheduleImageDialog initialMode={initialMode} />);
  fireEvent.click(screen.getByRole('button', { name: initialMode ? 'Lock screen image' : 'Save my picks as an image' }));
  // The dialog opens on Lock screen; most cases here exercise the Story shape.
  if (!initialMode && story) fireEvent.click(screen.getByRole('button', { name: 'Story' }));
}

describe('ScheduleImageDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the spec copy and the shape and day controls', () => {
    setup([set('s1', 0, '20:00')], { s1: 'must' }, undefined, false);
    expect(screen.getByRole('button', { name: 'Lock screen' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Story' }));
    expect(screen.getByText('Save your picks as an image')).toBeInTheDocument();
    expect(screen.getByText("One day per image. If your picks don't all fit, Must See picks come first.")).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Shape' })).toBeInTheDocument();
    expect(screen.getByText("A web page with your picks and your crew's schedules, ready to print.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Story' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Lock screen' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Day')).toBeInTheDocument();
  });

  it('swaps in the lock-screen options when Lock screen is selected', () => {
    setup([set('s1', 0, '20:00')], { s1: 'must' });
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Lock screen' }));
    expect(screen.getByRole('group', { name: 'Show' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'My picks' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables a day with only TBA picks', () => {
    setup([set('s1', 0, '20:00'), set('s2', 1, '')], { s1: 'must', s2: 'must' });
    const options = screen.getAllByRole('option') as HTMLOptionElement[];
    expect(options[0]!.disabled).toBe(false);
    expect(options[1]!.disabled).toBe(true);
  });

  it('shows the failure toast when capture rejects', async () => {
    mockCapture.mockRejectedValue(new Error('Capture failed'));
    setup([set('s1', 0, '20:00')], { s1: 'must' });
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(expect.any(Error), "Couldn't make the image. Try again."),
    );
  });

  it('shows the download toast when the image downloads', async () => {
    mockCapture.mockResolvedValue('downloaded');
    setup([set('s1', 0, '20:00')], { s1: 'must' });
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Image saved to your downloads.', 'success'));
  });

  it('shows the printable success toast', async () => {
    mockFetchPrintable.mockResolvedValue('<html></html>');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    setup([set('s1', 0, '20:00')], { s1: 'must' });
    fireEvent.click(screen.getByRole('button', { name: 'Download printable page' }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith('Printable page saved to your downloads.', 'success'),
    );
  });

  it('Print shape swaps the primary button for Print and calls window.print', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    setup([set('s1', 0, '20:00')], { s1: 'must' });
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(screen.queryByRole('button', { name: 'Save image' })).toBeNull();
    expect(document.querySelector('.festie-print-poster')).not.toBeNull();
    const buttons = screen.getAllByRole('button', { name: 'Print' });
    fireEvent.click(buttons[buttons.length - 1]!);
    expect(print).toHaveBeenCalledOnce();
    print.mockRestore();
  });

  it('shows the nothing-to-draw text and keeps the printable button when no day has timed picks', () => {
    setup([set('s1', 0, '')], { s1: 'must' });
    expect(
      screen.getByText('None of your picks have a set time yet, so there is nothing to draw.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save image' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download printable page' })).toBeInTheDocument();
  });

  it('opens the lock-screen options on Full lineup from the schedule entry, even with no picks', () => {
    setup([set('s1', 0, '20:00')], {}, 'full');
    expect(screen.getByRole('button', { name: 'Full lineup' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('group', { name: 'Shape' })).toBeNull();
  });
});
