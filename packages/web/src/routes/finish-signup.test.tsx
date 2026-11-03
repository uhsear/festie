import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockNavigate = vi.fn().mockResolvedValue(undefined);
let mockState: unknown;
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockState }),
  Link: ({ to, children, search: _search, ...rest }: { to: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const completeProviderSignup = vi.fn();
vi.mock('@festie/shared', () => ({ useAuth: () => ({ completeProviderSignup, isLoading: false }) }));

vi.mock('../components/layout/RouteErrorBoundary', () => ({
  RenderErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import FinishSignupPage from './finish-signup';
import { ApiClientError } from '@festie/shared/services/api';

const payload = { status: 'needs-signup', signupToken: 'tok', suggestedUsername: 'ada_l', email: 'ada@example.com', name: 'Ada' };

async function fill(user: ReturnType<typeof userEvent.setup>, dob: string) {
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: dob } });
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('FinishSignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState = payload;
  });

  it('redirects to /login when there is no router state', async () => {
    mockState = undefined;
    const { container } = render(<FinishSignupPage />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/login', replace: true }));
    expect(container).toBeEmptyDOMElement();
  });

  it('prefills the username and shows the email read-only', () => {
    render(<FinishSignupPage />);
    expect(screen.getByLabelText('Username')).toHaveValue('ada_l');
    expect(screen.getByDisplayValue('ada@example.com')).toHaveAttribute('readonly');
  });

  it('shows the private-relay note when Apple hid the email', () => {
    mockState = { ...payload, email: null };
    render(<FinishSignupPage />);
    expect(screen.getByDisplayValue('Hidden by Apple')).toBeInTheDocument();
  });

  it('blocks under-18 on the client', async () => {
    const user = userEvent.setup();
    render(<FinishSignupPage />);
    const year = new Date().getFullYear() - 10;
    await fill(user, `${year}-01-01`);
    expect(await screen.findByText('You must be at least 18 to use Festie')).toBeInTheDocument();
    expect(completeProviderSignup).not.toHaveBeenCalled();
  });

  it('completes signup and goes to /cards', async () => {
    completeProviderSignup.mockResolvedValue({ emailVerificationSent: false });
    const user = userEvent.setup();
    render(<FinishSignupPage />);
    await fill(user, '1995-01-01');
    await waitFor(() =>
      expect(completeProviderSignup).toHaveBeenCalledWith({
        signupToken: 'tok',
        username: 'ada_l',
        dateOfBirth: '1995-01-01',
        tosAccepted: true,
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' }));
  });

  it('returns to a safe `next` from login, and ignores an unsafe one', async () => {
    completeProviderSignup.mockResolvedValue({ emailVerificationSent: false });
    const user = userEvent.setup();
    mockState = { ...payload, next: '/join/abc' };
    const { unmount } = render(<FinishSignupPage />);
    await fill(user, '1995-01-01');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: '/join/abc' }));
    unmount();

    mockNavigate.mockClear();
    mockState = { ...payload, next: '//evil.example' };
    render(<FinishSignupPage />);
    await fill(user, '1995-01-01');
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' }));
  });

  it('shows the message and a link back to /login on SIGNUP_EXPIRED', async () => {
    completeProviderSignup.mockRejectedValue(new ApiClientError('Sign-up took too long. Start again.', 400, 'SIGNUP_EXPIRED'));
    const user = userEvent.setup();
    render(<FinishSignupPage />);
    await fill(user, '1995-01-01');
    expect(await screen.findByText(/Sign-up took too long/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });
});
