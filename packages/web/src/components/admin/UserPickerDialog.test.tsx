import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UserPickerDialog from './UserPickerDialog';

const mockFetchUsers = vi.fn();
vi.mock('@festie/shared/services/admin', () => ({
  fetchAdminUsers: (...a: unknown[]) => mockFetchUsers(...a),
}));

const alice = { id: 'u1', username: 'alice', email: 'alice@example.com' };
const bob = { id: 'u2', username: 'bob', email: 'bob@example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchUsers.mockResolvedValue({ users: [alice, bob], nextCursor: null, total: 2 });
});

function setup(props: Partial<React.ComponentProps<typeof UserPickerDialog>> = {}) {
  const onPick = vi.fn().mockResolvedValue(undefined);
  render(<UserPickerDialog open onOpenChange={() => {}} title="Add a member" onPick={onPick} {...props} />);
  return onPick;
}

describe('UserPickerDialog', () => {
  it('shows Already in crew for a member and no Add button', async () => {
    setup({ existingUserIds: ['u1'] });
    expect(await screen.findByText('@alice')).toBeInTheDocument();
    expect(screen.getByText('Already in crew')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add' })).toHaveLength(1);
  });

  it('disables Add when the crew is full', async () => {
    setup({ fullMessage: 'This crew is full.' });
    await screen.findByText('@alice');
    expect(screen.getByText('This crew is full.')).toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: 'Add' })) expect(b).toBeDisabled();
  });

  it('calls onPick with the user', async () => {
    const onPick = setup();
    await screen.findByText('@bob');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[1]!);
    expect(onPick).toHaveBeenCalledWith(bob);
  });
});
