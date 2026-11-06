import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ACCOUNT_REACTIVATED_MESSAGE, useAuthStore, useUIStore } from '@festie/shared/stores';
import { PROVIDER_COPY } from '@festie/shared/constants';
import { availableProviders, getNonce, getProviders, mapErrorToUserMessage } from '@festie/shared/services';
import type { ProviderCredentialBody, ProviderName, ProviderSignupPayload, ProvidersConfig } from '@festie/shared/types';
import Button from './Button';
import {
  appleAvailable,
  appleCredential,
  googleAvailable,
  googleCredential,
  loadAppleAuthentication,
} from '../lib/nativeProviders';
import { getPendingInvite } from '../lib/pendingInvite';
import { setReturnTo } from '../lib/returnTo';
import { makeStyles, typeStyle } from '../hooks/useTokens';

// The sign-up token stays out of the URL: the screen gets only this key.
const pendingSignups = new Map<string, ProviderSignupPayload>();

export function takePendingSignup(key: string | undefined): ProviderSignupPayload | undefined {
  if (!key) return undefined;
  const payload = pendingSignups.get(key);
  pendingSignups.delete(key);
  return payload;
}

const useStyles = makeStyles((t) => ({
  wrap: { marginTop: t.spacing[4], gap: t.spacing[3] },
  divider: { ...typeStyle('caption'), color: t.colors.text.muted, textAlign: 'center' as const },
  apple: { height: 48, width: '100%' as const },
  error: { ...typeStyle('label'), color: t.colors.text.danger, textAlign: 'center' as const },
}));

interface Props {
  mode: 'signin' | 'link' | 'reauth';
  /** On the register screen the Apple button reads "Continue with Apple". */
  register?: boolean;
  /** link and reauth: receives the credential instead of starting a sign-in. */
  onCredential?: (provider: ProviderName, body: ProviderCredentialBody) => Promise<void>;
  /** Limit the buttons to these providers (reauth lists only the linked ones). */
  only?: ProviderName[];
}

type AppleModule = NonNullable<Awaited<ReturnType<typeof loadAppleAuthentication>>>;

export default function ProviderButtons({ mode, register, onCredential, only }: Props) {
  const styles = useStyles();
  const daylight = useUIStore((s) => s.theme) === 'daylight';
  const router = useRouter();
  const signInWithProvider = useAuthStore((s) => s.signInWithProvider);
  const [cfg, setCfg] = useState<ProvidersConfig | null>(null);
  const [apple, setApple] = useState<AppleModule | null>(null);
  const [appleOk, setAppleOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [c, a, ok] = await Promise.all([getProviders(), loadAppleAuthentication(), appleAvailable()]);
        if (live) {
          setCfg(c);
          setApple(a);
          setAppleOk(ok);
        }
      } catch {
        // A failed providers call hides the buttons; password sign-in still works.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const providers = availableProviders(cfg, platform).filter((p) => {
    if (only && !only.includes(p)) return false;
    if (p === 'apple') return appleOk && apple != null;
    // App Store 4.8: Google on iOS only appears beside a working Apple button.
    return googleAvailable() && (platform !== 'ios' || appleOk);
  });
  if (providers.length === 0) return null;
  const googleLabel = mode === 'link' ? PROVIDER_COPY.linkGoogle : PROVIDER_COPY.continueGoogle;

  const run = async (provider: ProviderName) => {
    if (busy || !cfg) return;
    setBusy(true);
    setError(null);
    try {
      const body =
        provider === 'apple'
          ? await appleCredential(await getNonce())
          : cfg.google
            ? await googleCredential(cfg.google)
            : null;
      if (!body) return; // cancelled
      if (onCredential) {
        await onCredential(provider, body);
        return;
      }
      const result = await signInWithProvider(provider, body);
      if (result.status === 'needs-signup') {
        const k = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        pendingSignups.set(k, result);
        router.push({ pathname: '/(auth)/complete-signup', params: { k } });
        return;
      }
      if (result.reactivated) useUIStore.getState().showToast(ACCOUNT_REACTIVATED_MESSAGE, { kind: 'success' });
      // A guest who arrived through an invite link finishes that join first.
      const invite = getPendingInvite();
      if (invite) {
        setReturnTo(null);
        router.replace(`/join/${invite}`);
      }
    } catch (err) {
      setError(mapErrorToUserMessage(err, "Couldn't sign in. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.divider}>{PROVIDER_COPY.divider}</Text>
      {providers.map((p) =>
        p === 'apple' && apple ? (
          <apple.AppleAuthenticationButton
            key={p}
            buttonType={
              mode === 'signin' && !register
                ? apple.AppleAuthenticationButtonType.SIGN_IN
                : apple.AppleAuthenticationButtonType.CONTINUE
            }
            // Apple's guidance: a white button on the dark stage theme, a black one on daylight.
            buttonStyle={
              daylight ? apple.AppleAuthenticationButtonStyle.BLACK : apple.AppleAuthenticationButtonStyle.WHITE
            }
            cornerRadius={999}
            style={styles.apple}
            onPress={() => void run('apple')}
          />
        ) : (
          <Button
            key={p}
            label={googleLabel}
            variant="utility"
            icon="logo-google"
            loading={busy}
            onPress={() => void run('google')}
            accessibilityLabel={googleLabel}
          />
        ),
      )}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
