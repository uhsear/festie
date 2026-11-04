import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';

const festivalState: Record<string, unknown> = {};
const crewState: Record<string, unknown> = {};
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(festivalState),
  useCrewStore: (sel: (s: Record<string, unknown>) => unknown) => sel(crewState),
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ user: { id: 'u1' } }),
}));

const mockBuild = vi.fn();
vi.mock('@festie/shared/utils', () => ({
  LOCKSCREEN_PRESETS: [
    { id: 'iphone-15', label: 'iPhone 15', width: 1179, height: 2556 },
    { id: 'pixel-9', label: 'Pixel 9', width: 1080, height: 2424 },
  ],
  buildLockscreenModel: (...a: unknown[]) => mockBuild(...a),
  defaultScheduleImageDay: () => null,
  formatTime: (t: string) => t,
  setMinuteRange: () => null,
}));

const crewHook = { status: 'ready', retry: vi.fn() };
vi.mock('@festie/shared/hooks', () => ({ useCrewOverlapStatus: () => crewHook }));

const mockCaptureMany = vi.fn();
vi.mock('../../lib/shareImage', () => ({ captureAndShareImages: (...a: unknown[]) => mockCaptureMany(...a) }));

const mockToast = vi.fn();
const mockToastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast, toastError: mockToastError }),
}));

import LockscreenPanel from './LockscreenPanel';

const fakePage = (n: number, count: number) => ({
  header: { day: 'FRIDAY', daySizeU: 7.4, pageChip: count > 1 ? `${n}/${count}` : null, metaTop: 'Fest · Jun 10', metaBottom: 'x', metaSizeU: 2.9, y: 38, height: 11 },
  footer: { text: 'festie.us', showMark: true, y: 80, x: 26, width: 48, sizeU: 2.4 },
  body: { kind: 'list', tier: 'M', artistSizeU: 5.6, timeSizeU: 5.4, periodSizeU: 2.27, chipSizeU: 2.6, rows: [], clashSpans: [], divider: null },
  dayIndex: 0,
  setIds: [],
});
const fakeModel = (count: number, width = 1290, height = 2796) => ({
  width,
  height,
  heightU: (height / width) * 100,
  theme: 'dark',
  palette: { text: '#fff', text2: '#ccc', muted: '#999', surface: '#111', border: '#222', must: '#f00', want: '#0ff', maybe: '#fa0', clash: '#fa0' },
  background: { color: '#0a0a0a', sheet: null, glow: null },
  contentTopU: 38,
  contentEndU: 80,
  sideU: 6,
  mode: 'picks',
  pages: Array.from({ length: count }, (_, i) => fakePage(i + 1, count)),
  empty: count === 0,
});

const set = (id: string, dayIndex: number, startTime: string, stageId = 'st1') => ({
  id,
  artist: `Artist ${id}`,
  stageId,
  dayIndex,
  startTime,
  endTime: '23:00',
});

function setup(opts: { initialMode?: 'picks' | 'full' | 'stages' | 'crew'; crew?: boolean; picks?: Record<string, string> } = {}) {
  Object.keys(festivalState).forEach((k) => delete festivalState[k]);
  Object.assign(festivalState, {
    currentFestival: { id: 'f1', name: 'Fest' },
    currentProfile: { id: 'p1', picks: opts.picks ?? { s1: 'must' } },
    sets: [set('s1', 0, '20:00'), set('s2', 0, '21:00', 'st2'), set('s3', 1, '19:00')],
    stages: [
      { id: 'st1', name: 'Main', color: '#00e8d0' },
      { id: 'st2', name: 'Second', color: '#ff3366' },
    ],
    days: [
      { id: 'd0', label: 'Fri', date: '2026-06-10' },
      { id: 'd1', label: 'Sat', date: '2026-06-11' },
    ],
    selectedDay: 0,
  });
  crewState.activeCrew = opts.crew ? { id: 'c1' } : null;
  crewState.crewOverlap = {};
  render(<LockscreenPanel initialMode={opts.initialMode ?? 'picks'} />);
}

describe('LockscreenPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    crewHook.status = 'ready';
    mockBuild.mockImplementation(() => fakeModel(1));
  });

  it('preselects the initial mode', () => {
    setup({ initialMode: 'full' });
    expect(screen.getByRole('button', { name: 'Full lineup' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'My picks' })).toHaveAttribute('aria-pressed', 'false');
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'full', dayIndex: 0 }));
  });

  it('offers Crew only with an active crew', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Crew' })).toBeNull();
  });

  it('shows Crew with an active crew', () => {
    setup({ crew: true });
    expect(screen.getByRole('button', { name: 'Crew' })).toBeInTheDocument();
  });

  it('keeps at least one priority on', () => {
    setup({ picks: { s1: 'must', s2: 'maybe' } });
    for (const name of ['Must', 'Want', 'Maybe']) fireEvent.click(screen.getByRole('button', { name }));
    const on = ['Must', 'Want', 'Maybe'].filter(
      (name) => screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true',
    );
    expect(on).toEqual(['Maybe']);
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ priorities: ['maybe'] }));
  });

  it('shows stage chips only in Stages mode and passes the selection', () => {
    setup();
    expect(screen.queryByRole('group', { name: 'Stages' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'stages', stageIds: ['st1'] }));
  });

  it('offers Fit on one image only for grid modes', () => {
    setup();
    expect(screen.queryByLabelText('Fit on one image')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Full lineup' }));
    fireEvent.click(screen.getByLabelText('Fit on one image'));
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ onePage: true }));
  });

  it('passes theme, clock and the day choice to the model', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sunlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clock + widgets' }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: 'all' } });
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'light', clock: 'widgets', dayIndex: 'all' }));
  });

  it('remembers look options but not the mode', () => {
    setup({ initialMode: 'full' });
    fireEvent.click(screen.getByRole('button', { name: 'Sunlight' }));
    fireEvent.click(screen.getByRole('button', { name: 'Big clock' }));
    expect(JSON.parse(localStorage.getItem('festie.lockscreen.options.v1')!)).toMatchObject({ theme: 'light', clock: 'big' });
    expect(localStorage.getItem('festie.lockscreen.options.v1')).not.toContain('full');
  });

  it('restores saved look options and ignores bad JSON', () => {
    localStorage.setItem('festie.lockscreen.options.v1', JSON.stringify({ theme: 'light', clock: 'big', priorities: ['must'] }));
    setup();
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'light', clock: 'big', priorities: ['must'] }));
    localStorage.setItem('festie.lockscreen.options.v1', '{bad');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockBuild.mockClear();
    setup();
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark', clock: 'normal' }));
  });

  it('waits for crew picks and offers a way out when they fail', () => {
    crewHook.status = 'loading';
    setup({ initialMode: 'crew', crew: true });
    expect(screen.getByRole('button', { name: "Loading your crew's picks…" })).toBeDisabled();
    cleanup();
    crewHook.status = 'error';
    setup({ initialMode: 'crew', crew: true });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(crewHook.retry).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save without crew' }));
    expect(screen.getByRole('button', { name: 'My picks' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers to hide Maybe picks when that fits the day on one image', () => {
    mockBuild.mockImplementation((input: { priorities: string[] }) => fakeModel(input.priorities.includes('maybe') ? 2 : 1));
    setup({ picks: { s1: 'must', s2: 'maybe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fit on 1 image: hide 1 Maybe pick' }));
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ priorities: ['must', 'want-to-see'] }));
  });

  it('uses the chosen phone size preset', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Phone size'), { target: { value: 'pixel-9' } });
    expect(mockBuild).toHaveBeenLastCalledWith(expect.objectContaining({ width: 1080, height: 2424 }));
  });

  it('falls back to the generic size on a non-phone screen', () => {
    setup();
    expect(screen.getByRole('option', { name: 'This phone (estimated) (1290 × 2796)' })).toBeInTheDocument();
  });

  it('disables a day with nothing in the chosen mode', () => {
    setup({ picks: { s1: 'must' } });
    const sat = screen.getByRole('option', { name: 'Sat' }) as HTMLOptionElement;
    expect(sat.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Full lineup' }));
    expect((screen.getByRole('option', { name: 'Sat' }) as HTMLOptionElement).disabled).toBe(false);
  });

  it('pages the preview and labels the save button with the image count', () => {
    mockBuild.mockImplementation(() => fakeModel(3));
    setup();
    expect(screen.getByText('Image 1 of 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Image 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save 3 images' })).toBeInTheDocument();
  });

  it('saves every page in one call with numbered filenames', async () => {
    mockBuild.mockImplementation(() => fakeModel(3));
    mockCaptureMany.mockResolvedValue('downloaded');
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save 3 images' }));
    await waitFor(() => expect(mockCaptureMany).toHaveBeenCalledOnce());
    const [nodes, opts] = mockCaptureMany.mock.calls[0] as [HTMLElement[], { filenames: string[]; width: number }];
    expect(nodes).toHaveLength(3);
    expect(opts.filenames).toEqual([
      'festie-fest-friday-picks-1of3.png',
      'festie-fest-friday-picks-2of3.png',
      'festie-fest-friday-picks-3of3.png',
    ]);
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('3 images saved to your downloads.', 'success'));
  });

  it('shows the failure toast when capture rejects', async () => {
    mockCaptureMany.mockRejectedValue(new Error('Capture failed'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith(expect.any(Error), "Couldn't make the image. Try again."),
    );
  });

  it('shows both wallpaper hints on a desktop browser', () => {
    setup();
    expect(screen.getByText(/Settings › Notifications › Display As › Count/)).toBeInTheDocument();
    expect(screen.getByText(/Use as › Lock screen/)).toBeInTheDocument();
  });

  it('shows the empty message when the model has no pages', () => {
    mockBuild.mockImplementation(() => fakeModel(0));
    setup({ initialMode: 'full' });
    expect(screen.getByText('Nothing matches these options, so there is nothing to draw.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });

  it('points an empty picks image at the full lineup', () => {
    mockBuild.mockImplementation(() => fakeModel(0));
    setup({ picks: {} });
    expect(screen.getByText('You have no picks yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show full lineup' }));
    expect(screen.getByRole('button', { name: 'Full lineup' })).toHaveAttribute('aria-pressed', 'true');
  });
});
