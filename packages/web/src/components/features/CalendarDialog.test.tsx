// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const festivalState: Record<string, unknown> = {};
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(festivalState)),
}));

const mockFetchCalendarLinks = vi.fn();
vi.mock('@festie/shared/services', () => ({
  fetchCalendarLinks: (...args: unknown[]) => mockFetchCalendarLinks(...args),
}));

const mockBuild = vi.fn();
const mockDescribe = vi.fn();
vi.mock('@festie/shared/utils', () => ({
  buildPicksIcsExport: (...args: unknown[]) => mockBuild(...args),
  describeIcsExport: (...args: unknown[]) => mockDescribe(...args),
}));

vi.mock('lucide-react', () => ({
  CalendarPlus: () => <span />,
  X: () => <span />,
  Loader: () => <span />,
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

import CalendarDialog from './CalendarDialog';

describe('CalendarDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(festivalState).forEach((k) => delete festivalState[k]);
    Object.assign(festivalState, {
      currentFestival: { id: 'f1', name: 'Bonnaroo', location: 'TN' },
      currentProfile: { picks: { s1: 'must' }, notes: {}, reminders: { s1: 15 } },
      sets: [],
      stages: [],
    });
    mockBuild.mockReturnValue({ ics: 'BEGIN:VCALENDAR', timed: 1, timeTba: 0, skipped: 0 });
    mockDescribe.mockReturnValue('Added 1 set to your calendar file.');
    mockFetchCalendarLinks.mockResolvedValue({
      httpsUrl: 'https://festie.us/cal/t.ics',
      webcalUrl: 'webcal://festie.us/cal/t.ics',
      googleUrl: 'https://calendar.google.com/calendar/render?cid=x',
    });
  });

  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Add picks to calendar' }));

  it('Download once builds the export with reminders and toasts the summary', () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<CalendarDialog />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Download once' }));
    expect(mockBuild).toHaveBeenCalledWith(expect.objectContaining({ reminders: { s1: 15 } }));
    expect(mockToast).toHaveBeenCalledWith('Added 1 set to your calendar file.', 'success');
    clickSpy.mockRestore();
  });

  it('Subscribe shows the three link buttons and the leak note', async () => {
    render(<CalendarDialog />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe (stays up to date)' }));
    expect(await screen.findByRole('button', { name: 'Apple Calendar or Outlook' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Google Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy calendar link' })).toBeInTheDocument();
    expect(screen.getByText(/Anyone with this calendar link/)).toBeInTheDocument();
    expect(mockFetchCalendarLinks).toHaveBeenCalledWith('f1');
  });

  it('Cancel closes the chooser', () => {
    render(<CalendarDialog />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Download once' })).not.toBeInTheDocument();
  });

  it('Subscribe failure toasts an error', async () => {
    mockFetchCalendarLinks.mockRejectedValue(new Error('x'));
    render(<CalendarDialog />);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe (stays up to date)' }));
    await vi.waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        "Couldn't get your calendar link. Check your connection and try again.",
        'error',
      ),
    );
  });
});
