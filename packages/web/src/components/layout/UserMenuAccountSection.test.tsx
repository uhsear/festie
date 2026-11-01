import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));
vi.mock('@festie/shared', () => ({
  useAuthStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ uploadAvatar: vi.fn(), removeAvatar: vi.fn(), resendVerification: vi.fn() }),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));

import UserMenuAccountSection from './UserMenuAccountSection';

describe('UserMenuAccountSection', () => {
  it('links to /account so desktop users (no bottom nav) can reach it', () => {
    const onClose = vi.fn();
    render(
      <UserMenuAccountSection
        user={{ email: 'a@b.co' }}
        isLoading={false}
        onClose={onClose}
        onLogout={vi.fn()}
        onChangePassword={vi.fn()}
        onChangeEmail={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));
    expect(onClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/account' });
  });
});
