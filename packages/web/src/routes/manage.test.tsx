import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAuthStore } from '@festie/shared';
import { ApiClientError } from '@festie/shared/services/api';
import { createTestQueryClient, renderWithQueryClient } from '../test-utils';
import ManagePage from './manage';

const toast = vi.fn();
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast, toastError: vi.fn() }) }));
vi.mock('../components/admin/useAdminSearch', () => ({ useAdminSearch: () => [{}, vi.fn()] }));
vi.mock('../components/admin/AdminFestivals', () => ({
  default: ({ mode, organizations }: { mode: string; organizations: Array<{ name: string; role: string }> }) => (
    <p>
      festivals {mode}: {organizations.map((o) => `${o.name} ${o.role}`).join(', ')}
    </p>
  ),
}));

const mockGet = vi.fn();
vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => mockGet(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const resendVerification = vi.fn();
const render = () => renderWithQueryClient(<ManagePage />, createTestQueryClient({ queries: { gcTime: 0, retry: false } }));

beforeEach(() => {
  vi.clearAllMocks();
  resendVerification.mockResolvedValue(undefined);
  useAuthStore.setState({ resendVerification } as never);
});

describe('/manage', () => {
  it('claims and lists the member organizations through GET /manage/me', async () => {
    mockGet.mockResolvedValue({
      emailConfirmed: true,
      organizations: [{ id: 'o1', name: 'Venue A', role: 'owner', status: 'active', verified: false }],
    });
    render();
    expect(await screen.findByText('festivals organizer: Venue A owner')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/manage/me');
    expect(screen.queryByText(/Confirm your email/)).not.toBeInTheDocument();
  });

  it('tells a person with no organization which email to use', async () => {
    mockGet.mockResolvedValue({ emailConfirmed: true, organizations: [] });
    render();
    expect(await screen.findByText('You are not part of an organization on Festie yet.')).toBeInTheDocument();
    expect(screen.getByText('If a venue added you, sign in with the email address they used.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Contact us' })).toBeInTheDocument();
    expect(screen.queryByText(/festivals organizer/)).not.toBeInTheDocument();
  });

  it('asks to confirm the email and resends it', async () => {
    mockGet.mockResolvedValue({ emailConfirmed: false, organizations: [] });
    render();
    expect(await screen.findByText("Confirm your email to see and edit your organization's festivals.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resend email' }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('offers Retry when the organizations cannot load', async () => {
    mockGet.mockRejectedValueOnce(new ApiClientError('Server error', 500, 'INTERNAL_ERROR'));
    mockGet.mockResolvedValueOnce({ emailConfirmed: true, organizations: [] });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('You are not part of an organization on Festie yet.')).toBeInTheDocument();
  });
});
