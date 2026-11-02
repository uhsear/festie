import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '@festie/shared/services/api';
import AdminFestivals from './AdminFestivals';

const toast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast, toastError: vi.fn() }),
}));
vi.mock('./LineupImport', () => ({ default: () => null }));
vi.mock('./FestivalMapEditor', () => ({ default: () => null }));
vi.mock('./FestivalStatusPanel', () => ({ default: () => null }));
vi.mock('../../lib/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({ confirmLeave: (fn: () => void) => fn(), guardDialog: null }),
}));
vi.mock('./FestivalEditForm', () => ({
  default: ({
    onSave,
    onDiscard,
    formData,
    setFormData,
    notifyPickers,
    onNotifyPickersChange,
  }: {
    onSave: () => void;
    onDiscard: () => void;
    notifyPickers: boolean;
    onNotifyPickersChange: (v: boolean) => void;
    formData: { name?: string; days?: { id: string; label: string }[] };
    setFormData: (f: unknown) => void;
  }) => (
    <div>
      <button onClick={onSave}>save form</button>
      <button onClick={onDiscard}>discard form</button>
      <input
        type="checkbox"
        aria-label="Tell people whose picks changed"
        checked={notifyPickers}
        onChange={(e) => onNotifyPickersChange(e.target.checked)}
      />
      {/* Seeded once at mount, like SetEditor's artist-name drafts. */}
      <input aria-label="local draft" defaultValue={formData.name} />
      <button onClick={() => setFormData({ name: 'New Fest', location: 'There', timeZone: 'UTC' })}>fill form</button>
      {(formData.days ?? []).map((d) => (
        <span key={d.id} data-testid="day">
          {d.id}:{d.label}
        </span>
      ))}
      <button
        onClick={() =>
          setFormData({
            ...formData,
            days: (formData.days ?? []).map((d) => (d.id === 'day-0' ? { ...d, label: 'Changed' } : d)),
          })
        }
      >
        edit day 1
      </button>
    </div>
  ),
}));

const mockPut = vi.fn();
const mockPost = vi.fn();
vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    get: vi.fn(),
    put: (...a: unknown[]) => mockPut(...a),
    post: (...a: unknown[]) => mockPost(...a),
    delete: vi.fn(),
  },
}));

const FULL = {
  id: 'f1',
  name: 'Fest',
  location: 'Here',
  timeZone: 'UTC',
  updatedAt: '2026-10-01T00:00:00.000Z',
  stages: [],
  days: [],
};

const fetchAdminFestival = vi.fn();
const fetchArchivedFestivals = vi.fn();
const fetchDeleteImpact = vi.fn();
const restoreFestival = vi.fn();
vi.mock('@festie/shared/services/festivalAdmin', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchAdminFestivals: async () => [{ ...FULL, published: true, stageCount: 0, dayCount: 0 }],
  fetchAdminFestival: (...a: unknown[]) => fetchAdminFestival(...a),
  fetchArchivedFestivals: (...a: unknown[]) => fetchArchivedFestivals(...a),
  fetchDeleteImpact: (...a: unknown[]) => fetchDeleteImpact(...a),
  restoreFestival: (...a: unknown[]) => restoreFestival(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fetchAdminFestival.mockResolvedValue(FULL);
  fetchArchivedFestivals.mockResolvedValue([]);
  fetchDeleteImpact.mockResolvedValue({ profiles: 2, crews: 1, picks: 3 });
});

describe('AdminFestivals', () => {
  it('opens the removal dialog on CONFIRM_REMOVALS and re-sends with confirmRemovals', async () => {
    mockPut.mockRejectedValueOnce(
      new ApiClientError('This save removes sets', 409, 'CONFIRM_REMOVALS', undefined, undefined, {
        removal: { days: 1, sets: 24, picks: 113, ratings: 0 },
      }),
    );
    mockPut.mockResolvedValueOnce(undefined);

    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'save form' }));

    expect(await screen.findByText('Remove sets with picks?')).toBeInTheDocument();
    expect(screen.getByText(/removes 1 day, 24 sets and 113 picks/)).toBeInTheDocument();
    expect(mockPut.mock.calls[0][1]).toMatchObject({ expectedUpdatedAt: FULL.updatedAt });

    await userEvent.click(screen.getByRole('button', { name: 'Remove and save' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(2));
    expect(mockPut.mock.calls[1][1]).toMatchObject({ confirmRemovals: true, expectedUpdatedAt: FULL.updatedAt });
  });

  it('sends notify: false when the box is unchecked', async () => {
    mockPut.mockResolvedValueOnce({ ...FULL });
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const box = await screen.findByRole('checkbox', { name: 'Tell people whose picks changed' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'save form' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    expect(mockPut.mock.calls[0][1]).toMatchObject({ notify: false });
  });

  it('toasts the schedule notice, else the saved-changes line', async () => {
    mockPut.mockResolvedValueOnce({ ...FULL, scheduleNotice: { changes: 2, people: 0, notified: false } });
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'save form' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Saved. No one had picked the changed sets, so no alerts were sent.', 'success'),
    );
    mockPut.mockResolvedValueOnce({ ...FULL });
    await userEvent.click(await screen.findByRole('button', { name: 'save form' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Saved 0 changes.', 'success'));
  });

  it('opens the editor on the new id after create', async () => {
    mockPost.mockResolvedValueOnce({ id: 'new1' });
    fetchAdminFestival.mockResolvedValue({ ...FULL, id: 'new1' });
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: '+ Create New' }));
    await userEvent.click(await screen.findByRole('button', { name: 'fill form' }));
    await userEvent.click(screen.getByRole('button', { name: 'save form' }));
    await waitFor(() => expect(fetchAdminFestival).toHaveBeenCalledWith('new1'));
    expect(await screen.findByRole('button', { name: 'save form' })).toBeInTheDocument();
  });

  it('lists archived festivals and restores one', async () => {
    fetchArchivedFestivals.mockResolvedValue([
      { id: 'a1', name: 'Old Fest', location: 'There', deletedAt: '2026-10-01T00:00:00.000Z', publishedAt: null },
    ]);
    restoreFestival.mockResolvedValue({ id: 'a1', published: false });
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'Archived' }));
    expect(await screen.findByText('Old Fest')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(restoreFestival).toHaveBeenCalledWith('a1'));
  });

  it('shows the delete impact in the dialog', async () => {
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete Fest?')).toBeInTheDocument();
    expect(screen.getByText(/2 people joined this festival and 1 crew uses it/)).toBeInTheDocument();
  });

  it('gives loaded days distinct ids so one edit leaves the others alone', async () => {
    fetchAdminFestival.mockResolvedValue({
      ...FULL,
      days: [
        { label: 'Fri', date: '2026-07-03', sets: [] },
        { label: 'Sat', date: '2026-07-04', sets: [] },
      ],
    });
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(await screen.findByRole('button', { name: 'edit day 1' }));
    const days = await screen.findAllByTestId('day');
    expect(days.map((d) => d.textContent)).toEqual(['day-0:Changed', 'day-1:Sat']);
  });

  it('remounts the form on Discard so local drafts show the saved values again', async () => {
    render(<AdminFestivals />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const input = await screen.findByLabelText('local draft');
    await userEvent.type(input, ' Edited');
    expect(input).toHaveValue('Fest Edited');
    await userEvent.click(screen.getByRole('button', { name: 'discard form' }));
    expect(screen.getByLabelText('local draft')).toHaveValue('Fest');
  });
});
