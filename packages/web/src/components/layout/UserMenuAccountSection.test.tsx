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

  it('ends with a plain Support Festie link that opens in a new tab', () => {
    render(<UserMenuAccountSection user={{}} onClose={vi.fn()} onLogout={vi.fn()} />);
    const link = screen.getByRole('link', { name: 'Support Festie' });
    expect(link).toHaveAttribute('href', 'https://paypal.me/uhsear');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('shows Admin only for admins', () => {
    const { rerender } = render(<UserMenuAccountSection user={{}} onClose={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
    rerender(<UserMenuAccountSection user={{ isAdmin: true }} onClose={vi.fn()} onLogout={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Admin' })).toBeInTheDocument();
  });

  it('links to /manage only for a member of an organization', () => {
    const onClose = vi.fn();
    const { rerender } = render(<UserMenuAccountSection user={{}} onClose={onClose} onLogout={vi.fn()} />);
    expect(screen.queryByTestId('user-menu-manage-link')).toBeNull();
    rerender(<UserMenuAccountSection user={{ organizations: [] }} onClose={onClose} onLogout={vi.fn()} />);
    expect(screen.queryByTestId('user-menu-manage-link')).toBeNull();
    rerender(<UserMenuAccountSection user={{ organizations: [{ id: 'o1' }] }} onClose={onClose} onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Manage your festivals' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/manage' });
  });

  it('labels the sign-out button "Sign out" and calls onLogout', () => {
    const onLogout = vi.fn();
    render(<UserMenuAccountSection user={{}} onClose={vi.fn()} onLogout={onLogout} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onLogout).toHaveBeenCalled();
    expect(screen.queryByText('Logout')).toBeNull();
  });
});
