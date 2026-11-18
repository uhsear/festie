import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetTimeReleasePanel from './SetTimeReleasePanel';

const api = vi.hoisted(() => ({ panel: vi.fn(), send: vi.fn() }));
vi.mock('@festie/shared/services/timeReleases', () => ({ timeReleaseApi: api }));
const toast = vi.hoisted(() => ({ toast: vi.fn(), toastError: vi.fn() }));
vi.mock('../../lib/toastContext', () => ({ useToast: () => toast }));

const day = (over: Record<string, unknown> = {}) => ({
  date: '2027-02-05',
  label: 'Friday',
  timed: 44,
  total: 44,
  claimedAt: null,
  sentAt: null,
  recipients: null,
  previewTitle: 'Wasteland: Friday set times are out',
  ...over,
});
const data = (over: Record<string, unknown> = {}) => ({
  festivalName: 'Wasteland',
  canSend: true,
  recipientsNow: 812,
  emailRecipients: 800,
  emailCut: 0,
  emailOff: null,
  defaultBody: 'See who plays when and build your plan.',
  dates: [day()],
  orphanDates: [],
  ...over,
});

describe('SetTimeReleasePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.panel.mockResolvedValue(data());
    api.send.mockResolvedValue({ queued: true, dates: ['2027-02-05'], skipped: [], recipients: 812 });
  });

  it('shows the row and the prompt for a fully timed date nobody sent', async () => {
    render(<SetTimeReleasePanel festivalId="f1" />);
    expect(await screen.findByText('Fri 5 Feb · 44 of 44 timed · Not sent')).toBeInTheDocument();
    expect(screen.getByText('Friday: 44 of 44 sets timed. Alert not sent.')).toBeInTheDocument();
  });

  it('the confirm names the ceiling and the exact title, and Send claims one date', async () => {
    render(<SetTimeReleasePanel festivalId="f1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send alert' }));
    expect(
      screen.getByText('Alert goes to up to 812 people: "Wasteland: Friday set times are out".'),
    ).toBeInTheDocument();
    expect(screen.getByText('People who turned off lineup alerts, or have no app or email, get nothing.')).toBeInTheDocument();
    expect(api.send).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Custom line/), 'Gates at noon.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.send).toHaveBeenCalledWith('f1', { dates: ['2027-02-05'], note: 'Gates at noon.' });
    expect(toast.toast).toHaveBeenCalledWith('Set-times alert queued for up to 812 people.', 'success');
    expect(api.panel).toHaveBeenCalledTimes(2);
  });

  it('a partial date needs Send anyway, and then sends confirmPartial', async () => {
    api.panel.mockResolvedValue(data({ dates: [day({ timed: 1 })] }));
    render(<SetTimeReleasePanel festivalId="f1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send alert' }));
    expect(screen.getByText(/Only 1 of 44 Friday sets has a time/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.send).toHaveBeenCalledWith('f1', { dates: ['2027-02-05'], confirmPartial: true });
  });

  it('a sent date reads "Sent ... to N people" with no button, and a prompt does not show for it', async () => {
    api.panel.mockResolvedValue(
      data({ dates: [day({ claimedAt: '2027-01-06T10:00:00.000Z', sentAt: '2027-01-06T10:01:00.000Z', recipients: 640 })] }),
    );
    render(<SetTimeReleasePanel festivalId="f1" />);
    expect(await screen.findByText('Fri 5 Feb · 44 of 44 timed · Sent 6 Jan to 640 people')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send alert' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Alert not sent/)).not.toBeInTheDocument();
  });

  it('a stuck claim shows "Not finished" and a Retry button', async () => {
    api.panel.mockResolvedValue(data({ dates: [day({ claimedAt: new Date(Date.now() - 20 * 60_000).toISOString() })] }));
    render(<SetTimeReleasePanel festivalId="f1" />);
    expect(await screen.findByText('Fri 5 Feb · 44 of 44 timed · Not finished')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('a retry offers no custom line, says it resends the original alert, and sends no note', async () => {
    api.panel.mockResolvedValue(data({ dates: [day({ claimedAt: new Date(Date.now() - 20 * 60_000).toISOString() })] }));
    render(<SetTimeReleasePanel festivalId="f1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(screen.queryByLabelText(/Custom line/)).not.toBeInTheDocument();
    expect(screen.getByText(/Resends the original alert to up to 812 people/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.send).toHaveBeenCalledWith('f1', { dates: ['2027-02-05'] });
  });

  it('says how many people the daily email limit leaves without the email', async () => {
    api.panel.mockResolvedValue(data({ emailRecipients: 90, emailCut: 722 }));
    render(<SetTimeReleasePanel festivalId="f1" />);
    expect(await screen.findByText(/722 people get no email because of the daily email limit/)).toBeInTheDocument();
  });

  it('hands each load to onLoaded, and null when the load fails', async () => {
    const onLoaded = vi.fn();
    api.panel.mockRejectedValueOnce(new Error('down'));
    render(<SetTimeReleasePanel festivalId="f1" onLoaded={onLoaded} />);
    await screen.findByText("Couldn't load set-time alerts");
    expect(onLoaded).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Fri 5 Feb · 44 of 44 timed · Not sent');
    expect(onLoaded).toHaveBeenLastCalledWith(expect.objectContaining({ recipientsNow: 812 }));
  });

  it('when sending is closed it lists the rows read-only, with no button and no prompt', async () => {
    api.panel.mockResolvedValue(data({ canSend: false }));
    render(<SetTimeReleasePanel festivalId="f1" />);
    expect(await screen.findByText('Fri 5 Feb · 44 of 44 timed · Not sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send alert' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Alert not sent/)).not.toBeInTheDocument();
    expect(screen.getByText('Alerts send only for a published festival that is not over.')).toBeInTheDocument();
  });

  it('names an orphan release and the postal-address email note', async () => {
    api.panel.mockResolvedValue(
      data({ emailOff: 'no_postal_address', orphanDates: [{ date: '2027-02-04', claimedAt: 'x', sentAt: 'y' }] }),
    );
    render(<SetTimeReleasePanel festivalId="f1" />);
    expect(await screen.findByText('An alert went out for 4 Feb, which no day uses now.')).toBeInTheDocument();
    expect(screen.getByText('Email off: no postal address.')).toBeInTheDocument();
  });

  it('a failed send reports it and reloads the panel', async () => {
    api.send.mockRejectedValue(new Error('conflict'));
    render(<SetTimeReleasePanel festivalId="f1" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send alert' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(toast.toastError).toHaveBeenCalled();
    expect(api.panel).toHaveBeenCalledTimes(2);
  });

  it('a load error shows Retry, which loads again', async () => {
    api.panel.mockRejectedValueOnce(new Error('down'));
    render(<SetTimeReleasePanel festivalId="f1" />);
    expect(await screen.findByText("Couldn't load set-time alerts")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Fri 5 Feb · 44 of 44 timed · Not sent')).toBeInTheDocument();
  });
});
