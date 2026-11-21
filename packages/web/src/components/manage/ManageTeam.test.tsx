import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ManageOrganization, ManageOrganizationDetail } from '@festie/shared/services/organizer';
import { createTestQueryClient, renderWithQueryClient } from '../../test-utils';
import ManageTeam from './ManageTeam';

const toast = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError }) }));
vi.mock('../../hooks/useReauthPrompt', () => ({ useReauthPrompt: () => ({ askPassword: vi.fn(), reauthDialog: null }) }));

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();
vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    get: (...a: unknown[]) => mockGet(...a),
    post: (...a: unknown[]) => mockPost(...a),
    put: (...a: unknown[]) => mockPut(...a),
    delete: (...a: unknown[]) => mockDelete(...a),
  },
}));

const organization: ManageOrganization = { id: 'org-a', name: 'Venue A', role: 'owner', status: 'active', verified: false };

const detail = (over: Partial<ManageOrganizationDetail> = {}): ManageOrganizationDetail => ({
  id: 'org-a',
  name: 'Venue A',
  displayName: null,
  contactEmail: null,
  website: null,
  kind: 'venue',
  status: 'active',
  verified: false,
  role: 'owner',
  members: [
    { userId: 'u1', name: 'Alex', email: 'alex@venue.example', role: 'owner', active: true, addedBy: 'Festie support', createdAt: '2026-11-01T00:00:00.000Z' },
    { userId: 'u2', name: 'Sam', email: 'sam@venue.example', role: 'editor', active: true, addedBy: 'Alex', createdAt: '2026-11-02T00:00:00.000Z' },
  ],
  pending: [{ email: 'new@venue.example', role: 'viewer', addedBy: 'Alex', createdAt: '2026-11-03T00:00:00.000Z' }],
  upload: { usedBytes: 12 * 1024 * 1024, capBytes: 200 * 1024 * 1024 },
  ...over,
});

const render = (org: ManageOrganization = organization) =>
  renderWithQueryClient(<ManageTeam organization={org} />, createTestQueryClient({ queries: { gcTime: 0, retry: false } }));

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(detail());
});

describe('ManageTeam', () => {
  it('lets an owner see invitations and manage editors, but never the owner row', async () => {
    render();
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.getByText('new@venue.example')).toBeInTheDocument();
    expect(screen.getByLabelText('Role of Sam')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role of Alex')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Alex' })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Add a member' })).toBeInTheDocument();
    expect(screen.getByText('12 MB of 200 MB used for site-plan images.')).toBeInTheDocument();
    // An owner adds editors and viewers only.
    const roles = within(screen.getByRole('form', { name: 'Add a member' })).getAllByRole('option').map((o) => o.textContent);
    expect(roles).toEqual(['Editor', 'Viewer']);
  });

  it('adds a member through the members route', async () => {
    mockPost.mockResolvedValue({ kind: 'pending', role: 'editor', emailed: true });
    render();
    await userEvent.type(await screen.findByPlaceholderText('name@venue.example'), 'New@Venue.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/manage/organizations/org-a/members', { email: 'new@venue.example', role: 'editor' }));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Added.'), 'success');
  });

  it('removes a member only after the owner confirms', async () => {
    mockDelete.mockResolvedValue({ userId: 'u2', role: 'editor' });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Sam' }));
    expect(mockDelete).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/manage/organizations/org-a/members/u2'));
  });

  it('shows an editor the team without addresses, controls or the add form', async () => {
    mockGet.mockResolvedValue(
      detail({
        role: 'editor',
        pending: [],
        members: [{ userId: 'u1', name: 'Alex', role: 'owner', active: true, addedBy: 'Festie support', createdAt: '2026-11-01T00:00:00.000Z' }],
      }),
    );
    render({ ...organization, role: 'editor' });
    expect(await screen.findByText('Alex')).toBeInTheDocument();
    expect(screen.getByText(/Only an owner of Venue A can change the team: Alex/)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a member' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Waiting to join/)).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Organization profile' })).not.toBeInTheDocument();
    expect(screen.queryByText('alex@venue.example')).not.toBeInTheDocument();
  });

  it('hides the add form while the organization is pending and says why', async () => {
    mockGet.mockResolvedValue(detail({ status: 'pending' }));
    render({ ...organization, status: 'pending' });
    expect(await screen.findByText('Adding people unlocks when Festie approves your organization.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a member' })).not.toBeInTheDocument();
  });

  it('reads a suspended organization as paused, with no profile form', async () => {
    mockGet.mockResolvedValue(detail({ status: 'suspended' }));
    render({ ...organization, status: 'suspended' });
    expect(await screen.findByRole('alert')).toHaveTextContent("Your organization's access is paused");
    expect(screen.queryByRole('form', { name: 'Organization profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a member' })).not.toBeInTheDocument();
  });

  it('saves the profile with null for an emptied field', async () => {
    mockPut.mockResolvedValue(detail());
    mockGet.mockResolvedValue(detail({ displayName: 'Venue A Live' }));
    render();
    const display = await screen.findByLabelText(/Display name/);
    await userEvent.clear(display);
    await userEvent.click(screen.getByRole('button', { name: 'Save organization' }));
    await waitFor(() =>
      expect(mockPut).toHaveBeenCalledWith('/manage/organizations/org-a', { name: 'Venue A', displayName: null, contactEmail: null, website: null }),
    );
  });

  it('locks the name of a verified organization for its owner', async () => {
    mockGet.mockResolvedValue(detail({ verified: true }));
    render();
    const form = await screen.findByRole('form', { name: 'Organization profile' });
    expect(within(form).getByLabelText(/^Name/)).toBeDisabled();
    expect(within(form).getByText('Verified organizations can only be renamed by Festie support.')).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Display name/)).toBeEnabled();
  });

  it('offers Retry when the team cannot load', async () => {
    mockGet.mockRejectedValueOnce(new Error('network'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Sam')).toBeInTheDocument();
  });
});
