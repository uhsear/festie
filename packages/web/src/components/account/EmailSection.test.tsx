import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ACCOUNT_COPY } from '@festie/shared/constants';

const mockChangeEmail = vi.fn();
const mockResend = vi.fn();
const mockCheckSession = vi.fn();
let authState: Record<string, unknown>;

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: Object.assign((selector: (s: Record<string, unknown>) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));
vi.mock('@festie/shared/services/api', () => ({
  mapErrorToUserMessage: (_e: unknown, fallback: string) => fallback,
}));
const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));
vi.mock('../layout/ChangeEmailModal', () => ({
  default: ({ onSubmit }: { onSubmit: (e: string, p: string) => Promise<void> }) => (
    <button onClick={() => onSubmit('new@x.us', 'pw')}>submit-change</button>
  ),
}));

import EmailSection from './EmailSection';

function setAuth(user: Record<string, unknown>) {
  authState = { user, changeEmail: mockChangeEmail, resendVerification: mockResend, checkSession: mockCheckSession };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockChangeEmail.mockResolvedValue('Check it');
  mockResend.mockResolvedValue(undefined);
  mockCheckSession.mockResolvedValue(undefined);
});

describe('EmailSection', () => {
  it('shows Resend only for an unverified email', () => {
    setAuth({ id: 'u1', email: 'a@x.us', emailVerified: false });
    const { unmount } = render(<EmailSection />);
    expect(screen.getByRole('button', { name: ACCOUNT_COPY.emailResend })).toBeInTheDocument();
    unmount();
    setAuth({ id: 'u1', email: 'a@x.us', emailVerified: true });
    render(<EmailSection />);
    expect(screen.queryByRole('button', { name: ACCOUNT_COPY.emailResend })).not.toBeInTheDocument();
  });

  it('shows Add email with no address', () => {
    setAuth({ id: 'u1' });
    render(<EmailSection />);
    expect(screen.getByText(ACCOUNT_COPY.emailNotSet)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ACCOUNT_COPY.emailAdd })).toBeInTheDocument();
  });

  it('opens the modal and calls changeEmail, toasting the server message', async () => {
    const user = userEvent.setup();
    setAuth({ id: 'u1', email: 'a@x.us', emailVerified: true });
    render(<EmailSection />);
    await user.click(screen.getByRole('button', { name: ACCOUNT_COPY.emailChange }));
    await user.click(screen.getByText('submit-change'));
    await waitFor(() => expect(mockChangeEmail).toHaveBeenCalledWith('new@x.us', 'pw'));
    expect(mockToast).toHaveBeenCalledWith('Check it', 'success');
    await waitFor(() => expect(mockCheckSession).toHaveBeenCalled());
  });

  it('shows the pending address until it is confirmed', () => {
    setAuth({ id: 'u1', email: 'a@x.us', emailVerified: true, pendingEmail: 'new@x.us' });
    const { unmount } = render(<EmailSection />);
    expect(screen.getByText(ACCOUNT_COPY.emailPending('new@x.us'))).toBeInTheDocument();
    unmount();
    setAuth({ id: 'u1', email: 'a@x.us', emailVerified: true, pendingEmail: null });
    render(<EmailSection />);
    expect(screen.queryByText(/Waiting for you to confirm/)).not.toBeInTheDocument();
  });
});
