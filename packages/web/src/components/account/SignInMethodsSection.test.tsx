import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUIStore } from '@festie/shared/stores/uiStore';

const mockList = vi.fn();
const mockGetProviders = vi.fn();
const mockLink = vi.fn();
const mockUnlink = vi.fn();
const mockSetPassword = vi.fn();
vi.mock('@festie/shared/services/oauth', () => ({
  listIdentities: (...a: unknown[]) => mockList(...a),
  getProviders: (...a: unknown[]) => mockGetProviders(...a),
  linkIdentity: (...a: unknown[]) => mockLink(...a),
  unlinkIdentity: (...a: unknown[]) => mockUnlink(...a),
  setPassword: (...a: unknown[]) => mockSetPassword(...a),
}));

const mockAsk = vi.fn();
vi.mock('../../lib/useReauthPrompt', () => ({
  useReauthPrompt: () => ({ ask: mockAsk, reauthDialog: null }),
}));
vi.mock('../auth/ProviderButtons', () => ({
  default: ({ mode, only }: { mode: string; only?: string[] }) => <div data-only={only?.join(',')}>{`buttons-${mode}`}</div>,
}));

vi.mock('@festie/shared/services/admin', () => ({
  withReauth: async (run: () => Promise<unknown>, ask: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (err) {
      if ((err as { code?: string }).code !== 'REAUTH_REQUIRED') throw err;
    }
    if ((await ask()) === null) return null;
    return run();
  },
}));
vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: { username: 'alice', email: 'alice@example.com' } }),
}));
const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: mockToast }) }));

import SignInMethodsSection from './SignInMethodsSection';

const google = { provider: 'google', email: 'a@gmail.com', isPrivateEmail: false, createdAt: '2026-11-01' };

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SignInMethodsSection />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({ offlineMode: false });
  mockGetProviders.mockResolvedValue({
    google: { webClientId: 'g' },
    apple: { servicesId: 'a', redirectUri: 'https://festie.us/login' },
  });
});

describe('SignInMethodsSection', () => {
  it('renders the linked rows with the provider email and an unlink button', async () => {
    mockList.mockResolvedValue({ hasPassword: true, identities: [google] });
    renderSection();
    expect(await screen.findByText('a@gmail.com')).toBeInTheDocument();
    expect(screen.getByText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlink Google' })).toBeEnabled();
    // Only the providers the user has not linked yet are offered.
    expect(screen.getByText('buttons-link')).toHaveAttribute('data-only', 'apple');
  });

  it('disables unlink of the last sign-in method', async () => {
    mockList.mockResolvedValue({ hasPassword: false, identities: [google] });
    renderSection();
    const button = await screen.findByRole('button', { name: 'Unlink Google' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Add another way to sign in before you remove this one.');
  });

  it('shows Set a password only when the account has no password', async () => {
    mockList.mockResolvedValue({ hasPassword: true, identities: [google] });
    const { unmount } = renderSection();
    await screen.findByText('a@gmail.com');
    expect(screen.queryByRole('button', { name: 'Set a password' })).not.toBeInTheDocument();
    unmount();

    mockList.mockResolvedValue({ hasPassword: false, identities: [google] });
    renderSection();
    expect(await screen.findByRole('button', { name: 'Set a password' })).toBeInTheDocument();
  });

  it('opens the re-auth prompt on REAUTH_REQUIRED and retries the unlink', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ hasPassword: true, identities: [google] });
    mockUnlink
      .mockRejectedValueOnce(Object.assign(new Error('recent'), { code: 'REAUTH_REQUIRED' }))
      .mockResolvedValueOnce({ unlinked: 'google' });
    mockAsk.mockResolvedValue({ provider: 'google', idToken: 'x'.repeat(30) });

    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Unlink Google' }));

    await waitFor(() => expect(mockUnlink).toHaveBeenCalledTimes(2));
    expect(mockAsk).toHaveBeenCalledTimes(1);
    expect(mockToast).toHaveBeenCalledWith('Google unlinked', 'success');
  });

  it('sets a password through the re-auth wrapper', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ hasPassword: false, identities: [google] });
    mockSetPassword.mockResolvedValue({ success: true });

    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Set a password' }));
    await user.type(screen.getByPlaceholderText('New password'), 'Tr0ub4dor&3xyz');
    await user.type(screen.getByPlaceholderText('Confirm new password'), 'Tr0ub4dor&3xyz');
    await user.click(screen.getAllByRole('button', { name: 'Set a password' }).at(-1)!);

    await waitFor(() =>
      expect(mockSetPassword).toHaveBeenCalledWith({ newPassword: 'Tr0ub4dor&3xyz', confirmPassword: 'Tr0ub4dor&3xyz' }),
    );
  });
});
