import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LineupImportHistory from './LineupImportHistory';

const api = vi.hoisted(() => ({
  history: vi.fn(),
  announcement: vi.fn(),
  undo: vi.fn(),
  announce: vi.fn(),
  daysAnnouncement: vi.fn(),
  announceDays: vi.fn(),
}));
vi.mock('@festie/shared/services/lineupImport', () => ({ lineupImportApi: api }));
vi.mock('../../lib/toastContext', () => {
  const value = { toast: vi.fn(), toastError: vi.fn() };
  return { useToast: () => value };
});

const DAYS = {
  festivalName: 'Fest',
  actsWithDay: 1,
  actsTotal: 118,
  recipients: 12,
  audience: 12,
  emailRecipients: 12,
  emailCut: 0,
  emailOff: null,
};

describe('LineupImportHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.history.mockResolvedValue({ imports: [] });
    api.announcement.mockResolvedValue({
      recipients: 0,
      followers: 0,
      priorAttendees: 0,
      matchedFestivalNames: [],
      emailRecipients: 0,
      emailCut: 0,
      emailOff: null,
    });
    api.daysAnnouncement.mockResolvedValue({ ...DAYS, actsWithDay: 118, recipients: 12 });
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

  it('Announce days: shows the split with a warning, and sends only after the confirm', async () => {
    api.daysAnnouncement.mockResolvedValue({ ...DAYS });
    api.announceDays.mockResolvedValue({ queued: true, recipients: 12, emailRecipients: 12 });
    render(<LineupImportHistory festivalId="f1" festivalName="Fest" />);
    expect(await screen.findByText('1 of 118 acts have a day. 12 people get one alert.')).toBeInTheDocument();
    expect(screen.getByText(/Not every act has a day yet/)).toBeInTheDocument();
    expect(api.announceDays).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Announce days' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(api.announceDays).toHaveBeenCalledWith('f1');
  });

  it('Announce days: disabled with the reason when a send would be refused', async () => {
    api.daysAnnouncement.mockResolvedValue({ ...DAYS, actsWithDay: 0, reason: 'no_days' });
    render(<LineupImportHistory festivalId="f1" festivalName="Fest" />);
    expect(await screen.findByText('Give acts a day before you announce days.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Announce days' })).toBeDisabled();
  });

  it('Announce days: says email is off without a postal address', async () => {
    api.daysAnnouncement.mockResolvedValue({ ...DAYS, actsWithDay: 118, emailOff: 'no_postal_address', emailRecipients: 0 });
    render(<LineupImportHistory festivalId="f1" festivalName="Fest" />);
    expect(await screen.findByText('Email off: no postal address.')).toBeInTheDocument();
  });

  it('Announce lineup: names the followers, the past-edition users and the matched editions', async () => {
    api.announcement.mockResolvedValue({
      recipients: 5,
      followers: 3,
      priorAttendees: 2,
      matchedFestivalNames: ['Fest 2025', 'Fest 2024'],
      emailRecipients: 3,
      emailCut: 0,
      emailOff: null,
    });
    render(<LineupImportHistory festivalId="f1" festivalName="Fest" />);
    expect(
      await screen.findByText(/3 followers get push and email\. 2 people from earlier editions get push only\. Matched editions: Fest 2025, Fest 2024\./),
    ).toBeInTheDocument();
  });

  it('Announce lineup: stays pressable when push is done but the email limit cut followers', async () => {
    api.announcement.mockResolvedValue({
      recipients: 0,
      followers: 5,
      priorAttendees: 0,
      matchedFestivalNames: [],
      emailRecipients: 0,
      emailCut: 3,
      emailOff: null,
    });
    render(<LineupImportHistory festivalId="f1" festivalName="Fest" />);
    expect(await screen.findByText(/3 people get no email today/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Announce to 0 people' })).toBeEnabled();
    expect(screen.queryByText('No one to notify right now.')).not.toBeInTheDocument();
  });

  it('Announce lineup: disabled with the reason when no one is left to reach', async () => {
    render(<LineupImportHistory festivalId="f1" festivalName="Fest" />);
    expect(await screen.findByText('No one to notify right now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Announce to 0 people' })).toBeDisabled();
  });

  describe('undo warning', () => {
    const item = (touchedDates: string[]) => ({
      id: 'imp-1',
      createdAt: '2027-01-10T10:00:00.000Z',
      createdBy: 'asir',
      counts: { created: 1, updated: 0, newStages: 0, newDays: 0 },
      undoneAt: null,
      canUndo: true,
      touchedDates,
    });
    const releases = (sentAt: string | null) => ({
      festivalName: 'Fest',
      canSend: true,
      recipientsNow: 5,
      emailRecipients: 5,
      emailCut: 0,
      emailOff: null,
      defaultBody: 'x',
      dates: [
        { date: '2027-02-05', label: 'Friday', timed: 2, total: 2, claimedAt: sentAt, sentAt, recipients: 5, previewTitle: 'x' },
      ],
      orphanDates: [],
    });

    it('says a sent alert stays sent when the import touched a released date', async () => {
      api.history.mockResolvedValue({ imports: [item(['2027-02-05'])] });
      render(<LineupImportHistory festivalId="f1" festivalName="Fest" releases={releases('2027-01-06T10:00:00.000Z')} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Undo import' }));
      expect(await screen.findByText(/The Friday alert already went out\. Undo will not recall it\./)).toBeInTheDocument();
    });

    it('says nothing extra when the touched date was never released, or the release state did not load', async () => {
      api.history.mockResolvedValue({ imports: [item(['2027-02-05'])] });
      const first = render(<LineupImportHistory festivalId="f1" festivalName="Fest" releases={releases(null)} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Undo import' }));
      expect(screen.queryByText(/already went out/)).not.toBeInTheDocument();
      first.unmount();

      render(<LineupImportHistory festivalId="f1" festivalName="Fest" releases={null} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Undo import' }));
      expect(screen.getByText(/This removes the sets it added/)).toBeInTheDocument();
      expect(screen.queryByText(/already went out/)).not.toBeInTheDocument();
    });
  });
});
