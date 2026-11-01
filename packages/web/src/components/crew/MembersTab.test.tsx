import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MembersTab, { type MembersTabProps } from './MembersTab';

// Avatar depends on @festie/shared helpers — mock the module so tests
// don't need the full shared package wiring.
vi.mock('@festie/shared', () => ({
  getAvatarColor: () => '#888',
  getInitials: (name: string) => name.charAt(0).toUpperCase(),
  normalizeIdentityName: (name: string) => name,
}));

function makeProps(overrides: Partial<MembersTabProps> = {}): MembersTabProps {
  return {
    members: [
      { id: 'm1', userId: 'u1', name: 'Alice', username: 'alice', role: 'owner' as const },
      { id: 'm2', userId: 'u2', name: 'Bob', username: 'bob', role: 'member' as const },
      { id: 'm3', userId: 'u3', name: 'Charlie', username: 'charlie' },
    ],
    ownerId: 'u1',
    isAdmin: false,
    adminAddBusy: false,
    onForceAdd: vi.fn(),
    isOwner: false,
    currentUserId: 'u2',
    onTransferOwnership: vi.fn(),
    ...overrides,
  };
}

describe('MembersTab', () => {
  it('renders all member names', () => {
    render(<MembersTab {...makeProps()} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Charlie')).toBeInTheDocument();
  });

  it('shows owner badge for members with role "owner"', () => {
    render(<MembersTab {...makeProps()} />);
    const ownerBadges = screen.getAllByText(/Owner/);
    expect(ownerBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows owner badge for member matching ownerId even without role', () => {
    const members = [
      { id: 'm1', userId: 'u1', name: 'Alice', username: 'alice' }, // no role set
    ];
    render(<MembersTab {...makeProps({ members, ownerId: 'u1' })} />);
    expect(screen.getByText(/Owner/)).toBeInTheDocument();
  });

  it('does not show owner badge for regular members', () => {
    const members = [
      { id: 'm2', userId: 'u2', name: 'Bob', username: 'bob', role: 'member' as const },
    ];
    render(<MembersTab {...makeProps({ members, ownerId: 'u1' })} />);
    expect(screen.queryByText(/Owner/)).not.toBeInTheDocument();
  });

  it('renders empty state when members list is empty', () => {
    render(<MembersTab {...makeProps({ members: [] })} />);
    expect(screen.getByText('No members yet')).toBeInTheDocument();
    expect(screen.getByText(/Share the invite code below/)).toBeInTheDocument();
  });

  it('hides admin force-add section for non-admin users', () => {
    render(<MembersTab {...makeProps({ isAdmin: false })} />);
    expect(screen.queryByText('Force Add')).not.toBeInTheDocument();
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows admin force-add section for admin users', () => {
    render(<MembersTab {...makeProps({ isAdmin: true })} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getByText('Force Add')).toBeInTheDocument();
  });

  it('calls onForceAdd when admin clicks Force Add', async () => {
    const user = userEvent.setup();
    const onForceAdd = vi.fn();
    render(<MembersTab {...makeProps({ isAdmin: true, onForceAdd })} />);
    await user.click(screen.getByText('Force Add'));
    expect(onForceAdd).toHaveBeenCalledOnce();
  });

  it('disables Force Add button when adminAddBusy is true', () => {
    render(<MembersTab {...makeProps({ isAdmin: true, adminAddBusy: true })} />);
    const btn = screen.getByRole('button', { name: /adding/i });
    expect(btn).toBeDisabled();
  });

  it('shows "Adding..." text when adminAddBusy is true', () => {
    render(<MembersTab {...makeProps({ isAdmin: true, adminAddBusy: true })} />);
    expect(screen.getByText('Adding…')).toBeInTheDocument();
  });

  it('falls back to username when name is missing', () => {
    const members = [
      { id: 'm4', userId: 'u4', username: 'dave_99' },
    ];
    render(<MembersTab {...makeProps({ members, ownerId: undefined })} />);
    expect(screen.getByText('dave_99')).toBeInTheDocument();
  });

  // --- Manage disclosure ---

  it('shows a "Manage" button only on non-owner non-self rows when isOwner is true', () => {
    render(<MembersTab {...makeProps({ isOwner: true, currentUserId: 'u1' })} />);
    expect(screen.getAllByRole('button', { name: /^Manage / })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Manage Bob' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Manage Charlie' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manage Alice' })).not.toBeInTheDocument();
  });

  it('does not render "Manage" for the current user row', () => {
    render(<MembersTab {...makeProps({ isOwner: true, currentUserId: 'u2' })} />);
    expect(screen.queryByRole('button', { name: 'Manage Bob' })).not.toBeInTheDocument();
  });

  it('hides all "Manage" buttons when isOwner is false', () => {
    render(<MembersTab {...makeProps({ isOwner: false, currentUserId: 'u2' })} />);
    expect(screen.queryByRole('button', { name: /^Manage / })).not.toBeInTheDocument();
  });

  it('reveals labelled Make owner and Remove from crew buttons and calls the handlers', async () => {
    const user = userEvent.setup();
    const onKick = vi.fn();
    const onTransferOwnership = vi.fn();
    render(<MembersTab {...makeProps({ isOwner: true, currentUserId: 'u1', onKick, onTransferOwnership })} />);
    const manage = screen.getByRole('button', { name: 'Manage Bob' });
    await user.click(manage);
    expect(manage).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Manage Bob' });
    await user.click(within(group).getByRole('button', { name: 'Make owner' }));
    expect(onTransferOwnership).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
    await user.click(within(group).getByRole('button', { name: 'Remove from crew' }));
    expect(onKick).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
  });

  it('omits Remove from crew when onKick is not given', async () => {
    const user = userEvent.setup();
    render(<MembersTab {...makeProps({ isOwner: true, currentUserId: 'u1' })} />);
    await user.click(screen.getByRole('button', { name: 'Manage Bob' }));
    expect(screen.getByRole('button', { name: 'Make owner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove from crew' })).not.toBeInTheDocument();
  });

  it('puts Delete crew in an owner-only danger area and Leave crew for members', () => {
    const { rerender } = render(<MembersTab {...makeProps({ isOwner: true, currentUserId: 'u1', onDestroyCrew: vi.fn() })} />);
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete crew/ })).toBeInTheDocument();
    rerender(<MembersTab {...makeProps({ onDestroyCrew: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: /Delete crew/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave crew/ })).toBeInTheDocument();
  });
});
