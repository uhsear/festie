import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdminLayout from './AdminLayout';

const fetchAdminEnv = vi.fn();
vi.mock('@festie/shared/services/festivalAdmin', () => ({ fetchAdminEnv: () => fetchAdminEnv() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const renderLayout = () =>
  render(
    <AdminLayout title="Admin" onTabChange={vi.fn()} activeTab="a" tabs={[{ id: 'a', label: 'A' }]}>
      <p>body</p>
    </AdminLayout>,
  );

describe('AdminLayout environment band', () => {
  beforeEach(() => fetchAdminEnv.mockReset());

  it('shows the band when a label is set', async () => {
    fetchAdminEnv.mockResolvedValue({ label: 'STAGING' });
    renderLayout();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'STAGING environment. Changes here do not reach festie.us.',
    );
  });

  it('shows no band without a label', async () => {
    fetchAdminEnv.mockResolvedValue({ label: null });
    renderLayout();
    await screen.findByText('body');
    await Promise.resolve();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
