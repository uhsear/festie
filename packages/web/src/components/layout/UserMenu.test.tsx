import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { mockNavigate, logout } = vi.hoisted(() => ({ mockNavigate: vi.fn(), logout: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));
vi.mock('@festie/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared')>()),
  useAuthStore: (selector: (s: { logout: typeof logout }) => unknown) => selector({ logout }),
}));
vi.mock('./UserMenuProfileCard', () => ({ default: () => null }));

import UserMenu from './UserMenu';

describe('UserMenu sign out', () => {
  it('asks before signing out, like Account > Sign out', async () => {
    render(<UserMenu user={{ id: 'u1', username: 'asir' }} />);
    fireEvent.click(screen.getByTestId('profile-badge'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(logout).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out' }).find((b) => dialog.contains(b))!);
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
