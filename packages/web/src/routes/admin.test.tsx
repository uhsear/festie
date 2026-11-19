import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useAuthStore } from '@festie/shared';

const navigate = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));
vi.mock('../components/admin/useAdminSearch', () => ({
  ADMIN_TABS: ['dashboard', 'festivals', 'users', 'crews', 'audit', 'analytics'],
  useAdminSearch: () => [{ tab: 'dashboard' }, vi.fn()],
}));
vi.mock('../components/admin/AdminLayout', () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="admin-layout">
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));
vi.mock('../components/admin/AdminCommandPalette', () => ({
  default: () => null,
  openAdminPalette: vi.fn(),
}));
vi.mock('../components/admin/AdminDashboard', () => ({
  default: () => <div>dashboard content</div>,
}));

import AdminPanel from './admin';

const baseUser = { id: 'u1', username: 'tester', name: 'Tester', email: 't@example.test' };

describe('AdminPanel route gate', () => {
  beforeEach(() => {
    navigate.mockClear();
    useAuthStore.setState({ user: null });
  });

  it('denies a signed-out visitor and renders no admin UI', () => {
    render(<AdminPanel />);
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-layout')).not.toBeInTheDocument();
  });

  it('denies a signed-in non-admin user', () => {
    useAuthStore.setState({ user: { ...baseUser, isAdmin: false } as never });
    render(<AdminPanel />);
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByTestId('admin-layout')).not.toBeInTheDocument();
  });

  it('sends a denied user back to /cards', () => {
    render(<AdminPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/cards' });
  });

  it('renders the admin panel for an admin', async () => {
    useAuthStore.setState({ user: { ...baseUser, isAdmin: true } as never });
    render(<AdminPanel />);
    expect(screen.queryByText('Access Denied')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Admin Panel' })).toBeInTheDocument();
    expect(await screen.findByText('dashboard content')).toBeInTheDocument();
  });
});
