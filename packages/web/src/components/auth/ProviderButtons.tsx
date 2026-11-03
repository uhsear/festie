import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@festie/shared';
import { getNonce, getProviders, availableProviders } from '@festie/shared/services/oauth';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { PROVIDER_COPY } from '@festie/shared/constants';
import { ACCOUNT_REACTIVATED_MESSAGE } from '@festie/shared/stores/authStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { ProviderCredentialBody, ProviderName } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import { APPLE_JS_SRC, GOOGLE_GSI_SRC, loadScript } from '../../lib/providerScripts';

interface GoogleId {
  initialize(cfg: Record<string, unknown>): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
interface AppleAuth {
  init(cfg: Record<string, unknown>): void;
  signIn(): Promise<{
    authorization: { code?: string; id_token: string; state?: string };
    user?: { name?: { firstName?: string; lastName?: string } };
  }>;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
    AppleID?: { auth: AppleAuth };
  }
}

export interface ProviderButtonsProps {
  mode: 'signin' | 'link' | 'reauth';
  /** Required for `link` and `reauth`: receives the provider token instead of signing in. */
  onCredential?: (provider: ProviderName, body: ProviderCredentialBody) => void | Promise<void>;
  /** Limit the buttons to these providers, e.g. the unlinked ones for `link` or the linked ones for `reauth`. */
  only?: ProviderName[];
  /** `signin` only: the validated return path (login's `next`), kept through finish-signup. */
  next?: string;
}

const FALLBACK_ERROR = 'That sign-in did not work. Try again.';

const isPopupClosed = (err: unknown) =>
  typeof err === 'object' && err !== null && (err as { error?: string }).error === 'popup_closed_by_user';

type Submit = (provider: ProviderName, body: ProviderCredentialBody) => Promise<void>;
type SubmitRef = React.MutableRefObject<Submit>;

function AppleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

export default function ProviderButtons({ mode, onCredential, only, next }: ProviderButtonsProps) {
  const navigate = useNavigate();
  const { signInWithProvider } = useAuth();
  const { toast } = useToast();
  const dark = useUIStore((s) => s.theme) !== 'daylight';
  const [error, setError] = useState('');
  const { data: cfg } = useQuery({ queryKey: ['auth', 'providers'], queryFn: getProviders, staleTime: 5 * 60_000 });
  const providers = availableProviders(cfg, 'web').filter((p) => !only || only.includes(p));

  const submit: Submit = async (provider, body) => {
    setError('');
    try {
      if (mode !== 'signin') {
        await onCredential?.(provider, body);
        return;
      }
      const result = await signInWithProvider(provider, body);
      if (result.status === 'needs-signup') {
        // State, not the URL: the signup token must stay out of history and logs.
        await navigate({ to: '/signup/finish', state: { ...result, next } as never });
        return;
      }
      if (result.reactivated) toast(ACCOUNT_REACTIVATED_MESSAGE, 'success');
      await (next ? navigate({ href: next }) : navigate({ to: '/cards' }));
    } catch (err) {
      if (!isPopupClosed(err)) setError(mapErrorToUserMessage(err, FALLBACK_ERROR));
    }
  };
  const submitRef = useRef<Submit>(submit);
  submitRef.current = submit;
  const onError = useCallback((message: string) => setError(message), []);

  if (!cfg || providers.length === 0) return null;

  return (
    <div className="w-full max-w-[360px] relative z-[1] mt-4 flex flex-col gap-3 text-left">
      <div className="flex items-center gap-3 text-[length:var(--font-size-14)] text-text-secondary" aria-hidden="true">
        <span className="h-px flex-1 bg-current opacity-30" />
        {PROVIDER_COPY.divider}
        <span className="h-px flex-1 bg-current opacity-30" />
      </div>
      {providers.includes('google') && cfg.google && (
        <GoogleButton clientId={cfg.google.webClientId} dark={dark} submitRef={submitRef} onError={onError} />
      )}
      {providers.includes('apple') && cfg.apple && (
        <AppleButton
          servicesId={cfg.apple.servicesId ?? ''}
          redirectUri={cfg.apple.redirectUri ?? ''}
          dark={dark}
          submitRef={submitRef}
          onError={onError}
        />
      )}
      {error && (
        <div role="alert" aria-live="assertive" className="text-[var(--color-text-danger)] text-[length:var(--font-size-14)]">
          {error}
        </div>
      )}
    </div>
  );
}

// GSI keeps one global config (one callback, one nonce), so only the newest mounted Google button
// initializes it. When that button unmounts (a closed re-auth dialog), the one below re-initializes,
// so its clicks reach a live handler with a fresh nonce.
const gsiOwners: Array<() => void> = [];

function GoogleButton({
  clientId,
  dark,
  submitRef,
  onError,
}: {
  clientId: string;
  dark: boolean;
  submitRef: SubmitRef;
  onError: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // A nonce is single use, so each credential callback bumps this to fetch a fresh one and re-render the button.
  const [round, setRound] = useState(0);
  const reclaim = useRef(() => setRound((n) => n + 1)).current;

  useEffect(() => {
    gsiOwners.push(reclaim);
    return () => {
      gsiOwners.splice(gsiOwners.indexOf(reclaim), 1);
      gsiOwners.at(-1)?.();
    };
  }, [reclaim]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await loadScript(GOOGLE_GSI_SRC);
        const nonce = await getNonce();
        const el = host.current;
        const gsi = window.google?.accounts.id;
        if (cancelled || !el || !gsi || gsiOwners.at(-1) !== reclaim) return;
        gsi.initialize({
          client_id: clientId,
          nonce,
          ux_mode: 'popup',
          use_fedcm_for_button: true,
          callback: (resp: { credential: string }) => {
            void submitRef.current('google', { idToken: resp.credential, nonce }).finally(() => setRound((n) => n + 1));
          },
        });
        gsi.renderButton(el, {
          type: 'standard',
          text: 'continue_with',
          shape: 'pill',
          theme: dark ? 'filled_black' : 'outline',
          width: Math.min(360, el.clientWidth || 360),
        });
      } catch (err) {
        if (!cancelled) onError(mapErrorToUserMessage(err, FALLBACK_ERROR));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, dark, round, submitRef, onError, reclaim]);

  return <div ref={host} className="flex min-h-11 justify-center" aria-label={PROVIDER_COPY.continueGoogle} />;
}

function AppleButton({
  servicesId,
  redirectUri,
  dark,
  submitRef,
  onError,
}: {
  servicesId: string;
  redirectUri: string;
  dark: boolean;
  submitRef: SubmitRef;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Load early so the click handler can open the popup soon after the user's tap.
  useEffect(() => {
    loadScript(APPLE_JS_SRC).catch((err) => onError(mapErrorToUserMessage(err, FALLBACK_ERROR)));
  }, [onError]);

  const handleClick = async () => {
    setBusy(true);
    try {
      await loadScript(APPLE_JS_SRC);
      const auth = window.AppleID?.auth;
      if (!auth) throw new Error(FALLBACK_ERROR);
      const nonce = await getNonce();
      const state = crypto.randomUUID();
      auth.init({ clientId: servicesId, scope: 'name email', redirectURI: redirectUri, state, nonce, usePopup: true });
      const r = await auth.signIn();
      if (r.authorization.state !== state) return;
      const name = r.user?.name;
      await submitRef.current('apple', {
        idToken: r.authorization.id_token,
        nonce,
        ...(r.authorization.code ? { authorizationCode: r.authorization.code } : {}),
        redirectUri,
        ...(name ? { name: { givenName: name.firstName, familyName: name.lastName } } : {}),
      });
    } catch (err) {
      if (!isPopupClosed(err)) onError(mapErrorToUserMessage(err, FALLBACK_ERROR));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={
        'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border px-4 text-[length:var(--font-size-16)] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua disabled:opacity-60 ' +
        (dark ? 'border-white bg-black text-white' : 'border-black bg-white text-black')
      }
    >
      <AppleLogo />
      {PROVIDER_COPY.continueApple}
    </button>
  );
}
