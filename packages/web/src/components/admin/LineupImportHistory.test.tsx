import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineupImportHistory from './LineupImportHistory';

const api = vi.hoisted(() => ({ history: vi.fn(), announcement: vi.fn(), undo: vi.fn(), announce: vi.fn() }));
vi.mock('@festie/shared/services/lineupImport', () => ({ lineupImportApi: api }));
vi.mock('../../lib/toastContext', () => {
  const value = { toast: vi.fn(), toastError: vi.fn() };
  return { useToast: () => value };
});

describe('LineupImportHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.history.mockResolvedValue({ imports: [] });
    api.announcement.mockResolvedValue({ recipients: 0 });
  });

  it('load fails, shows the error, Retry reloads', async () => {
    api.history.mockRejectedValueOnce(new Error('down'));
    render(<LineupImportHistory festivalId="f1" festivalName="Fest" />);
    expect(await screen.findByText("Couldn't load import history")).toBeInTheDocument();
    expect(screen.queryByText('No imports yet.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No imports yet.')).toBeInTheDocument();
    expect(api.history).toHaveBeenCalledTimes(2);
  });
});
