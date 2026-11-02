import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));

import UserMenuAccountSection from './UserMenuAccountSection';

describe('UserMenuAccountSection', () => {
  it('links to /account so desktop users (no bottom nav) can reach it', () => {
    const onClose = vi.fn();
    render(<UserMenuAccountSection user={{}} onClose={onClose} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/account' });
  });

  it('has no photo, email or password rows', () => {
    render(<UserMenuAccountSection user={{}} onClose={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.queryByTestId('avatar-upload-button')).toBeNull();
    expect(screen.queryByTestId('resend-verification-button')).toBeNull();
    expect(screen.queryByText('Password')).toBeNull();
  });

  it('shows Admin only for admins', () => {
    const { rerender } = render(<UserMenuAccountSection user={{}} onClose={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    rerender(<UserMenuAccountSection user={{ isAdmin: true }} onClose={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  it('labels the sign-out button "Sign out" and calls onLogout', () => {
    const onLogout = vi.fn();
    render(<UserMenuAccountSection user={{}} onClose={vi.fn()} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLogout).toHaveBeenCalled();
    expect(screen.queryByText('Logout')).toBeNull();
  });
});
