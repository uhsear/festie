import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const get = vi.fn();
const put = vi.fn();

vi.mock('@festie/shared/services/api', () => ({
  api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a), post: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast, toastError: vi.fn() }),
}));
vi.mock('./LineupImport', () => ({ default: () => null }));
vi.mock('./FestivalMapEditor', () => ({ default: () => null }));
vi.mock('./FestivalLinks', () => ({
  default: ({ festivalName, onClose }: { festivalName: string; onClose: () => void }) => (
    <button onClick={onClose}>links panel for {festivalName}</button>
  ),
}));

import AdminFestivals from './AdminFestivals';

const festival = {
  id: 'f1',
  name: 'Fest',
  location: 'Orlando',
  timeZone: 'America/New_York',
  stages: [],
  days: [],
};

async function openEditorAndSave() {
  render(<AdminFestivals />);
  fireEvent.click(await screen.findByText('Edit'));
  const box = (await screen.findByRole('checkbox', { name: /Tell people whose picks changed/ })) as HTMLInputElement;
  await waitFor(() => expect((screen.getByLabelText('Festival Name') as HTMLInputElement).value).toBe('Fest'));
  return box;
}

describe('AdminFestivals notify switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (url: string) => (url === '/admin/festivals' ? [festival] : festival));
  });

  it('sends notify: false when the box is unchecked', async () => {
    put.mockResolvedValue({ ...festival });
    const box = await openEditorAndSave();
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    fireEvent.click(screen.getByText('Update Festival'));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0][0]).toBe('/admin/festivals/f1');
    expect(put.mock.calls[0][1]).toMatchObject({ notify: false });
  });

  it('toasts the schedule notice', async () => {
    put.mockResolvedValue({ ...festival, scheduleNotice: { changes: 2, people: 0, notified: false } });
    await openEditorAndSave();
    fireEvent.click(screen.getByText('Update Festival'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'Saved. No one had picked the changed sets, so no alerts were sent.',
        'success',
      ),
    );
  });

  it('keeps Festival updated when the server sends no notice', async () => {
    put.mockResolvedValue({ ...festival });
    await openEditorAndSave();
    fireEvent.click(screen.getByText('Update Festival'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Festival updated', 'success'));
  });
});

describe('AdminFestivals Links button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockImplementation(async (url: string) => (url === '/admin/festivals' ? [festival] : festival));
  });

  it('opens the links panel for the row and returns to the list', async () => {
    render(<AdminFestivals />);
    fireEvent.click(await screen.findByRole('button', { name: 'Spotify links for Fest' }));
    fireEvent.click(await screen.findByText('links panel for Fest'));
    expect(await screen.findByText('Edit')).toBeTruthy();
  });

  it('shows the save note and the pick-count error when engagement fails', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/admin/festivals') return [festival];
      if (url.endsWith('/set-engagement')) throw new Error('boom');
      return festival;
    });
    await openEditorAndSave();
    expect(await screen.findByText("Couldn't load pick counts.")).toBeTruthy();
    expect(screen.getByText(/Saving sends a “Schedule Updated” notification/)).toBeTruthy();
  });
});
