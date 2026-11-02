import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FestivalAnnouncements from './FestivalAnnouncements';

const api = vi.hoisted(() => ({ adminList: vi.fn(), create: vi.fn(), cancel: vi.fn() }));
vi.mock('@festie/shared/services/announcements', () => ({ announcementsApi: api }));
vi.mock('../../lib/toastContext', () => {
  const value = { toast: vi.fn(), toastError: vi.fn() };
  return { useToast: () => value };
});

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  festivalId: 'f1',
  severity: 'info',
  title: 'Gates open',
  body: 'Come early',
  screen: 'home',
  sendAt: '2026-11-02T10:00:00.000Z',
  sentAt: null,
  cancelledAt: null,
  recipientCount: null,
  createdBy: 'u1',
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

const renderIt = () => render(<FestivalAnnouncements festivalId="f1" festivalName="Fest" />);

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Hello');
  await user.type(screen.getByLabelText('Message'), 'World');
}

describe('FestivalAnnouncements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.adminList.mockResolvedValue({ festivalName: 'Fest', recipients: 3, announcements: [] });
    api.create.mockResolvedValue({ announcement: row(), recipients: 3 });
    api.cancel.mockResolvedValue({ announcement: row() });
  });

  it('shows counters and disables submit until title and message are set', async () => {
    const user = userEvent.setup();
    renderIt();
    const submit = await screen.findByRole('button', { name: 'Send to 3 people' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('0/80')).toBeInTheDocument();
    expect(screen.getByText('0/200')).toBeInTheDocument();
    await fill(user);
    expect(screen.getByText('5/80')).toBeInTheDocument();
    expect(screen.getByText('5/200')).toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('send now waits for confirm, then posts the exact body', async () => {
    const user = userEvent.setup();
    renderIt();
    await fill(user);
    await user.click(await screen.findByRole('button', { name: 'Send to 3 people' }));
    expect(api.create).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith('f1', {
        severity: 'info',
        title: 'Hello',
        body: 'World',
        screen: 'home',
      }),
    );
    await waitFor(() => expect(api.adminList).toHaveBeenCalledTimes(2));
  });

  it('schedule posts sendAt as ISO with no confirm', async () => {
    const user = userEvent.setup();
    renderIt();
    await fill(user);
    await user.click(screen.getByLabelText('Urgent'));
    await user.selectOptions(screen.getByLabelText('Opens'), 'map');
    await user.click(screen.getByLabelText('Send at a set time'));
    const input = screen.getByLabelText(/^Send at \(your time/);
    await user.type(input, '2030-05-06T07:08');
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith('f1', {
        severity: 'urgent',
        title: 'Hello',
        body: 'World',
        screen: 'map',
        sendAt: new Date('2030-05-06T07:08').toISOString(),
      }),
    );
  });

  it('shows status lines', async () => {
    api.adminList.mockResolvedValue({
      festivalName: 'Fest',
      recipients: 3,
      announcements: [
        row({ id: 's', title: 'Sched' }),
        row({ id: 'd', title: 'Done', sentAt: '2026-11-01T11:00:00.000Z', recipientCount: 5 }),
        row({ id: 'c', title: 'Gone', cancelledAt: '2026-11-01T11:00:00.000Z' }),
      ],
    });
    renderIt();
    expect(await screen.findByText(/^Scheduled for /)).toBeInTheDocument();
    expect(screen.getByText(/^Sent .* to 5 people$/)).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('cancel calls cancel without asking', async () => {
    const user = userEvent.setup();
    api.adminList.mockResolvedValue({ festivalName: 'Fest', recipients: 3, announcements: [row()] });
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('f1', 'a1'));
  });

  it('take down asks first, then calls cancel', async () => {
    const user = userEvent.setup();
    api.adminList.mockResolvedValue({
      festivalName: 'Fest',
      recipients: 3,
      announcements: [row({ sentAt: new Date(Date.now() - 60_000).toISOString(), recipientCount: 2 })],
    });
    renderIt();
    await user.click(await screen.findByRole('button', { name: 'Take down banner' }));
    expect(api.cancel).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Take down' }));
    await waitFor(() => expect(api.cancel).toHaveBeenCalledWith('f1', 'a1'));
  });

  it('hides take down once the banner is older than 24 hours', async () => {
    const sentAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    api.adminList.mockResolvedValue({
      festivalName: 'Fest',
      recipients: 3,
      announcements: [row({ sentAt, recipientCount: 2 })],
    });
    renderIt();
    expect(await screen.findByText(/^Sent /)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take down banner' })).not.toBeInTheDocument();
  });
});
