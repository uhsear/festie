import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestQueryClient, renderWithQueryClient } from '../../test-utils';
import AdminOrganizations from './AdminOrganizations';

const toast = vi.fn();
const toastError = vi.fn();
const setAdminSearch = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError }) }));
vi.mock('../../hooks/useReauthPrompt', () => ({ useReauthPrompt: () => ({ askPassword: vi.fn(), reauthDialog: null }) }));
vi.mock('./useAdminSearch', () => ({ useAdminSearch: () => [{}, setAdminSearch] }));
vi.mock('@festie/shared/services/admin', () => ({ withReauth: (run: () => unknown) => run() }));

const svc = {
  fetchOrganizations: vi.fn(),
  fetchOrganization: vi.fn(),
  createOrganization: vi.fn(),
  setOrganizationStatus: vi.fn(),
  setOrganizationVerified: vi.fn(),
  addOrganizationMember: vi.fn(),
  removeOrganizationMember: vi.fn(),
  removePendingMember: vi.fn(),
  fetchReviewQueue: vi.fn(),
  releaseHeldAlerts: vi.fn(),
  discardHeldAlerts: vi.fn(),
  declinePublishRequest: vi.fn(),
  transferFestival: vi.fn(),
};
vi.mock('@festie/shared/services/adminOrganizations', () => ({
  fetchOrganizations: (...a: unknown[]) => svc.fetchOrganizations(...a),
  fetchOrganization: (...a: unknown[]) => svc.fetchOrganization(...a),
  createOrganization: (...a: unknown[]) => svc.createOrganization(...a),
  setOrganizationStatus: (...a: unknown[]) => svc.setOrganizationStatus(...a),
  setOrganizationVerified: (...a: unknown[]) => svc.setOrganizationVerified(...a),
  addOrganizationMember: (...a: unknown[]) => svc.addOrganizationMember(...a),
  removeOrganizationMember: (...a: unknown[]) => svc.removeOrganizationMember(...a),
  removePendingMember: (...a: unknown[]) => svc.removePendingMember(...a),
  fetchReviewQueue: (...a: unknown[]) => svc.fetchReviewQueue(...a),
  releaseHeldAlerts: (...a: unknown[]) => svc.releaseHeldAlerts(...a),
  discardHeldAlerts: (...a: unknown[]) => svc.discardHeldAlerts(...a),
  declinePublishRequest: (...a: unknown[]) => svc.declinePublishRequest(...a),
  transferFestival: (...a: unknown[]) => svc.transferFestival(...a),
}));
const publishFestival = vi.fn();
vi.mock('@festie/shared/services/festivalAdmin', () => ({
  publishFestival: (...a: unknown[]) => publishFestival(...a),
  fetchAdminFestivals: vi.fn(async () => [
    { id: 'f1', name: 'Venue Fest', stageCount: 1, dayCount: 1, startDate: '', endDate: '', published: false, updatedAt: '' },
    { id: 'f9', name: 'Platform Fest', stageCount: 1, dayCount: 1, startDate: '', endDate: '', published: true, updatedAt: '' },
  ]),
}));
vi.mock('@festie/shared/services/organizer', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchManageFestivals: vi.fn(),
}));

const org = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  name: 'Venue A',
  kind: 'venue',
  website: null,
  status: 'pending',
  verifiedAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  memberCount: 0,
  pendingCount: 1,
  festivalCount: 0,
  ownerCount: 0,
  ...over,
});

const detail = (over: Record<string, unknown> = {}) => ({
  ...org(),
  members: [{ userId: 'u1', username: 'sam', email: 'sam@venue.example', active: true, role: 'owner', addedBy: null, createdAt: '2026-11-01T00:00:00.000Z' }],
  pending: [{ email: 'kim@venue.example', role: 'editor', addedBy: null, createdAt: '2026-11-01T00:00:00.000Z' }],
  usage: { festivals: 1, drafts: 1, announcementsThisMonth: 2, uploadedBytes: 3 * 1024 * 1024 },
  festivals: [{ id: 'f1', name: 'Venue Fest', location: '', organizationId: 'o1', slug: null, published: false, deleted: false, publishRequestedAt: null, publishReviewNote: null, updatedAt: '2026-11-01T00:00:00.000Z' }],
  ...over,
});

const queue = (over: Record<string, unknown> = {}) => ({
  requests: [{ festivalId: 'f1', name: 'Venue Fest', organizationId: 'o1', organizationName: 'Venue A', verified: false, requestedAt: '2026-11-02T12:00:00.000Z' }],
  held: [{ festivalId: 'f2', name: 'Live Fest', organizationId: 'o1', organizationName: 'Venue A', changes: 3, people: 41, updatedAt: '2026-11-02T12:00:00.000Z' }],
  recentEdits: [{ id: 'a1', createdAt: '2026-11-03T12:00:00.000Z', action: 'festival.updated', festivalId: 'f2', name: 'Live Fest', organizationId: 'o1', organizationName: 'Venue A', details: null }],
  ...over,
});

const render = () => renderWithQueryClient(<AdminOrganizations />, createTestQueryClient({ queries: { gcTime: 0, retry: false } }));

beforeEach(() => {
  vi.clearAllMocks();
  svc.fetchOrganizations.mockResolvedValue([org(), org({ id: 'o2', name: 'Promoter B', status: 'active', verifiedAt: '2026-11-01', ownerCount: 1 })]);
  svc.fetchOrganization.mockResolvedValue(detail());
  svc.fetchReviewQueue.mockResolvedValue(queue());
});

describe('AdminOrganizations', () => {
  it('lists organizations with plain status words and filters them', async () => {
    render();
    expect(await screen.findByText('Venue A')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for activation')).toHaveLength(2);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText(/No owner yet/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'active');
    expect(screen.queryByText('Venue A')).not.toBeInTheDocument();
    expect(screen.getByText('Promoter B')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Show'), '');
    await userEvent.click(screen.getByLabelText('Only organizations with no owner'));
    expect(screen.getByText('Venue A')).toBeInTheDocument();
    expect(screen.queryByText('Promoter B')).not.toBeInTheDocument();
  });

  it('creates an organization and opens it', async () => {
    svc.createOrganization.mockResolvedValue(org({ id: 'o9', name: 'New Venue' }));
    render();
    await screen.findByText('Venue A');
    await userEvent.type(screen.getByLabelText('Organization name'), ' New Venue ');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'promoter');
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    await waitFor(() => expect(svc.createOrganization).toHaveBeenCalledWith({ name: 'New Venue', kind: 'promoter', website: null }));
    await waitFor(() => expect(svc.fetchOrganization).toHaveBeenCalledWith('o9'));
  });

  it('shows what the organization used', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Venue A' }));
    expect(await screen.findByText(/1 festivals \(1 drafts\)\. 2 announcements this month\. 3 MB of site-plan images stored\./)).toBeInTheDocument();
  });

  it('adds a member by email, lower-cased, with the chosen role', async () => {
    svc.addOrganizationMember.mockResolvedValue({ kind: 'pending' });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Venue A' }));
    await screen.findByRole('heading', { name: 'Venue A' });
    await userEvent.type(screen.getByLabelText('Member email'), 'Owner@Venue.Example');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'editor');
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(svc.addOrganizationMember).toHaveBeenCalledWith('o1', { email: 'owner@venue.example', role: 'editor' }));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Member added'), 'success');
  });

  it('removes a member and a pending member after confirmation', async () => {
    svc.removeOrganizationMember.mockResolvedValue({});
    svc.removePendingMember.mockResolvedValue({});
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Venue A' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove sam@venue.example' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(svc.removeOrganizationMember).toHaveBeenCalledWith('o1', 'u1'));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove kim@venue.example from the waiting list' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(svc.removePendingMember).toHaveBeenCalledWith('o1', 'kim@venue.example'));
  });

  it('activates a pending organization, verifies it after confirmation and suspends it after confirmation', async () => {
    svc.setOrganizationStatus.mockResolvedValue(org());
    svc.setOrganizationVerified.mockResolvedValue(org());
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Venue A' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(svc.setOrganizationStatus).toHaveBeenCalledWith('o1', 'active'));
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(screen.getByText('A verified organization publishes its festivals without your review.')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(svc.setOrganizationVerified).toHaveBeenCalledWith('o1', true));
    await userEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Suspend' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), ' Chargeback dispute ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(svc.setOrganizationStatus).toHaveBeenCalledWith('o1', 'suspended', 'Chargeback dispute'));
  });

  it('moves a festival into the organization after confirmation, and lists only festivals it does not hold', async () => {
    svc.transferFestival.mockResolvedValue({ festivalId: 'f9', from: null, to: 'o1' });
    svc.setOrganizationStatus.mockResolvedValue(org());
    svc.fetchOrganization.mockResolvedValueOnce(detail());
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Venue A' }));
    expect(await screen.findByText('Activate the organization to move a festival into it.')).toBeInTheDocument();
    svc.fetchOrganization.mockResolvedValue(detail({ status: 'active' }));
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }));
    const select = await screen.findByLabelText('Move a festival here');
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Platform Fest' })).toBeInTheDocument());
    expect(within(select).queryByRole('option', { name: 'Venue Fest' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move festival' })).toBeDisabled();
    await userEvent.selectOptions(select, 'f9');
    await userEvent.click(screen.getByRole('button', { name: 'Move festival' }));
    expect(screen.getByText(/It is live, and it stays live/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move festival' }));
    await waitFor(() => expect(svc.transferFestival).toHaveBeenCalledWith('o1', 'f9'));
  });

  it('lists the recent organizer edits of live festivals in the review section', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Review queue (1)' }));
    expect(await screen.findByText('Recent organizer edits on live festivals (1)')).toBeInTheDocument();
    expect(screen.getByText('Live Fest: Festival updated')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open Live Fest' }));
    expect(setAdminSearch).toHaveBeenCalledWith({ tab: 'festivals', festival: 'f2' });
  });

  it('shows the counts on the section buttons and approves a request', async () => {
    publishFestival.mockResolvedValue({ publishedAt: 'x', checklist: [] });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Review queue (1)' }));
    expect(screen.getByRole('button', { name: 'Held alerts (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve Venue Fest' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishFestival).toHaveBeenCalledWith('f1'));
    expect(toast).toHaveBeenCalledWith('Venue Fest is live. The owners get an email.', 'success');
  });

  it('declines with a note, and keeps Decline disabled until there is one', async () => {
    svc.declinePublishRequest.mockResolvedValue({ declined: true });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Review queue (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decline Venue Fest' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Decline' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Add the stage map.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(svc.declinePublishRequest).toHaveBeenCalledWith('f1', 'Add the stage map.'));
  });

  it('opens the admin preview from the queue', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Review queue (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Preview Venue Fest' }));
    expect(setAdminSearch).toHaveBeenCalledWith({ tab: 'festivals', preview: 'f1' });
  });

  it('shows held counts and sends or discards the held alerts', async () => {
    svc.releaseHeldAlerts.mockResolvedValue({ released: 3, people: 41 });
    svc.discardHeldAlerts.mockResolvedValue({ discarded: 1 });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Held alerts (1)' }));
    expect(screen.getByText(/3 held changes, 41 people would be told/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send the alerts for Live Fest' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send alert' }));
    await waitFor(() => expect(svc.releaseHeldAlerts).toHaveBeenCalledWith('f2'));
    expect(toast).toHaveBeenCalledWith('Sent 3 alerts to 41 people.', 'success');
    await userEvent.click(screen.getByRole('button', { name: 'Discard the alerts for Live Fest' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(svc.discardHeldAlerts).toHaveBeenCalledWith('f2'));
  });

  it('has no structural accessibility violations in the list, the detail, the queue and the held alerts', async () => {
    const { container } = render();
    await screen.findByText('Venue A');
    await expect(container).toBeAccessible();
    await userEvent.click(screen.getByRole('button', { name: 'Review queue (1)' }));
    await screen.findByRole('button', { name: 'Approve Venue Fest' });
    await expect(container).toBeAccessible();
    await userEvent.click(screen.getByRole('button', { name: 'Held alerts (1)' }));
    await screen.findByRole('button', { name: 'Send the alerts for Live Fest' });
    await expect(container).toBeAccessible();
    await userEvent.click(screen.getByRole('button', { name: 'Organizations' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Venue A' }));
    await screen.findByRole('heading', { name: 'Venue A' });
    await expect(container).toBeAccessible();
  });

  it('says so when nothing waits', async () => {
    svc.fetchReviewQueue.mockResolvedValue({ requests: [], held: [] });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Review queue' }));
    expect(screen.getByText('Nothing is waiting for review.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Held alerts' }));
    expect(screen.getByText('No alerts are held.')).toBeInTheDocument();
  });
});
