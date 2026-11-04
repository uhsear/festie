import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockNavigate = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mockNavigate }));

const signInWithProvider = vi.fn();
vi.mock('@festie/shared', () => ({ useAuth: () => ({ signInWithProvider }) }));

const mockGetProviders = vi.fn();
vi.mock('@festie/shared/services/oauth', async () => {
  const actual = await vi.importActual<typeof import('@festie/shared/services/oauth')>('@festie/shared/services/oauth');
  return { ...actual, getProviders: () => mockGetProviders(), getNonce: () => Promise.resolve('nonce-1234567890abcdef') };
});

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('../../lib/providerScripts', () => ({
  GOOGLE_GSI_SRC: 'g',
  APPLE_JS_SRC: 'a',
  loadScript: () => Promise.resolve(),
}));

import ProviderButtons from './ProviderButtons';
import { ApiClientError } from '@festie/shared/services/api';

const NONCE = 'nonce-1234567890abcdef';
const google = { webClientId: 'g-client', iosClientId: null };
const apple = { servicesId: 'us.festie.web', redirectUri: 'https://festie.us/login' };
const win = window as unknown as Record<string, unknown>;

function renderButtons(props: Partial<React.ComponentProps<typeof ProviderButtons>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProviderButtons mode="signin" {...props} />
    </QueryClientProvider>,
  );
}

let googleCallback: ((r: { credential: string }) => void) | undefined;
let googleInits = 0;
let appleSignIn: ReturnType<typeof vi.fn>;
let appleState = '';

beforeEach(() => {
  vi.clearAllMocks();
  googleCallback = undefined;
  googleInits = 0;
  appleState = '';
  appleSignIn = vi.fn();
  win.google = {
    accounts: {
      id: {
        initialize: (cfg: { callback: typeof googleCallback }) => {
          googleInits += 1;
          googleCallback = cfg.callback;
        },
        renderButton: vi.fn(),
      },
    },
  };
  win.AppleID = { auth: { init: (cfg: { state: string }) => (appleState = cfg.state), signIn: appleSignIn } };
});

afterEach(() => {
  delete win.google;
  delete win.AppleID;
});

describe('ProviderButtons', () => {
  it('renders nothing when no provider is configured', async () => {
    mockGetProviders.mockResolvedValue({ google: null, apple: null });
    const { container } = renderButtons();
    await waitFor(() => expect(mockGetProviders).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('posts the Google credential with its nonce', async () => {
    mockGetProviders.mockResolvedValue({ google, apple: null });
    signInWithProvider.mockResolvedValue({ status: 'signed-in', reactivated: false });
    renderButtons();
    await waitFor(() => expect(googleCallback).toBeDefined());
    googleCallback!({ credential: 'google-id-token-xxxxxxxxxx' });
    await waitFor(() =>
      expect(signInWithProvider).toHaveBeenCalledWith('google', { idToken: 'google-id-token-xxxxxxxxxx', nonce: NONCE }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/cards' }));
  });

  it('posts code, name and nonce for Apple when state matches', async () => {
    mockGetProviders.mockResolvedValue({ google: null, apple });
    signInWithProvider.mockResolvedValue({ status: 'signed-in', reactivated: true });
    appleSignIn.mockImplementation(async () => ({
      authorization: { code: 'apple-code', id_token: 'apple-id-token-xxxxxxxxxx', state: appleState },
      user: { name: { firstName: 'Ada', lastName: 'Lovelace' } },
    }));
    renderButtons();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Apple' }));
    await waitFor(() =>
      expect(signInWithProvider).toHaveBeenCalledWith('apple', {
        idToken: 'apple-id-token-xxxxxxxxxx',
        nonce: NONCE,
        authorizationCode: 'apple-code',
        redirectUri: apple.redirectUri,
        name: { givenName: 'Ada', familyName: 'Lovelace' },
      }),
    );
    expect(mockToast).toHaveBeenCalled();
  });

  it('posts nothing when the Apple state does not match', async () => {
    mockGetProviders.mockResolvedValue({ google: null, apple });
    appleSignIn.mockResolvedValue({ authorization: { code: 'c', id_token: 'apple-id-token-xxxxxxxxxx', state: 'other' } });
    renderButtons();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Apple' }));
    await waitFor(() => expect(appleSignIn).toHaveBeenCalled());
    expect(signInWithProvider).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('navigates to finish-signup with the payload in router state on needs-signup', async () => {
    mockGetProviders.mockResolvedValue({ google, apple: null });
    const payload = { status: 'needs-signup', signupToken: 't', suggestedUsername: 'ada', email: 'a@b.co', name: 'Ada' };
    signInWithProvider.mockResolvedValue(payload);
    renderButtons();
    await waitFor(() => expect(googleCallback).toBeDefined());
    googleCallback!({ credential: 'google-id-token-xxxxxxxxxx' });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/signup/finish', state: payload }));
  });

  it('shows the server message for a 409 IDENTITY_EMAIL_IN_USE', async () => {
    mockGetProviders.mockResolvedValue({ google, apple: null });
    signInWithProvider.mockRejectedValue(new ApiClientError('An account already uses this email.', 409, 'IDENTITY_EMAIL_IN_USE'));
    renderButtons();
    await waitFor(() => expect(googleCallback).toBeDefined());
    googleCallback!({ credential: 'google-id-token-xxxxxxxxxx' });
    expect(await screen.findByRole('alert')).toHaveTextContent('An account already uses this email.');
  });

  it('shows only the providers passed in `only`', async () => {
    mockGetProviders.mockResolvedValue({ google, apple });
    renderButtons({ mode: 'link', onCredential: vi.fn(), only: ['apple'] });
    expect(await screen.findByRole('button', { name: 'Link Apple' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Link Google')).toBeNull();
  });

  it('returns to `next` after sign-in and carries it to finish-signup', async () => {
    mockGetProviders.mockResolvedValue({ google, apple: null });
    signInWithProvider.mockResolvedValueOnce({ status: 'signed-in', reactivated: false });
    renderButtons({ next: '/join/abc' });
    await waitFor(() => expect(googleCallback).toBeDefined());
    googleCallback!({ credential: 'google-id-token-xxxxxxxxxx' });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: '/join/abc' }));

    const payload = { status: 'needs-signup', signupToken: 't', suggestedUsername: 'ada', email: null, name: null };
    signInWithProvider.mockResolvedValueOnce(payload);
    await waitFor(() => expect(googleInits).toBe(2));
    googleCallback!({ credential: 'google-id-token-yyyyyyyyyy' });
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/signup/finish', state: { ...payload, next: '/join/abc' } }),
    );
  });

  it('gives the Google callback back to the page button when a newer one unmounts', async () => {
    mockGetProviders.mockResolvedValue({ google, apple: null });
    const pageLink = vi.fn();
    const dialogLink = vi.fn();
    renderButtons({ mode: 'link', onCredential: pageLink });
    await waitFor(() => expect(googleInits).toBe(1));
    const dialog = renderButtons({ mode: 'reauth', onCredential: dialogLink });
    await waitFor(() => expect(googleInits).toBe(2));
    dialog.unmount();
    await waitFor(() => expect(googleInits).toBe(3));
    googleCallback!({ credential: 'google-id-token-xxxxxxxxxx' });
    await waitFor(() => expect(pageLink).toHaveBeenCalledWith('google', expect.objectContaining({ idToken: 'google-id-token-xxxxxxxxxx' })));
    expect(dialogLink).not.toHaveBeenCalled();
  });

  it('labels the link buttons Link Google and Link Apple, not Continue with', async () => {
    mockGetProviders.mockResolvedValue({ google, apple });
    renderButtons({ mode: 'link', onCredential: vi.fn() });
    expect(await screen.findByRole('button', { name: 'Link Apple' })).toBeInTheDocument();
    expect(screen.getByLabelText('Link Google')).toBeInTheDocument();
    expect(screen.queryByText(/Continue with/)).toBeNull();
  });

  it('shows nothing when the Apple popup is closed', async () => {
    mockGetProviders.mockResolvedValue({ google: null, apple });
    appleSignIn.mockRejectedValue({ error: 'popup_closed_by_user' });
    renderButtons();
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Apple' }));
    await waitFor(() => expect(appleSignIn).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
