import { useEffect, useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PROVIDER_COPY } from '@festie/shared/constants';
import {
  availableProviders,
  getProviders,
  linkIdentity,
  mapErrorToUserMessage,
  unlinkIdentity,
  withReauth,
} from '@festie/shared/services';
import type { IdentitySummary, ProviderCredentialBody, ProviderName, ProvidersConfig } from '@festie/shared/types';
import AppPressable from './AppPressable';
import ProviderButtons from './ProviderButtons';
import { useReauthPrompt } from './admin';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

const ROW_PROVIDERS: ProviderName[] = ['google', 'apple'];

/**
 * Sign-in methods for the Account screen: Password, Google and Apple, each with Link or Unlink.
 * Mirrors the web SignInMethodsSection. Link and unlink need a recent auth, so both run through
 * withReauth. The server refuses to remove the last method; the button is disabled to match.
 * Set password lives in AccountPasswordSection.
 */
interface AccountSignInMethodsSectionProps {
  /** The Account screen's shared copy; null while loading or after a failed load hides the section. */
  identities: IdentitySummary | null;
  /** Reloads the shared copy after a link or unlink. */
  onChanged: () => Promise<void>;
}

export default function AccountSignInMethodsSection({ identities: state, onChanged }: AccountSignInMethodsSectionProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { ask, reauthDialog } = useReauthPrompt();
  const [cfg, setCfg] = useState<ProvidersConfig | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProviders()
      .then(setCfg)
      .catch(() => {});
  }, []);

  if (!state) return null;

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const offered = availableProviders(cfg, platform);
  const methodCount = (state.hasPassword ? 1 : 0) + state.identities.length;

  const link = async (provider: ProviderName, body: ProviderCredentialBody) => {
    setError(null);
    setMessage(null);
    try {
      const done = await withReauth(() => linkIdentity(provider, body), ask);
      if (done === null) return;
      haptics.success();
      setMessage(PROVIDER_COPY.linked(PROVIDER_COPY.providerLabel[provider]));
      await onChanged();
    } catch (err) {
      haptics.warning();
      setError(mapErrorToUserMessage(err, "Couldn't link this account. Try again."));
    }
  };

  const unlink = async (provider: ProviderName) => {
    setError(null);
    setMessage(null);
    try {
      const done = await withReauth(() => unlinkIdentity(provider), ask);
      if (done === null) return;
      haptics.success();
      setMessage(PROVIDER_COPY.unlinked(PROVIDER_COPY.providerLabel[provider]));
      await onChanged();
    } catch (err) {
      haptics.warning();
      setError(mapErrorToUserMessage(err, "Couldn't unlink this account. Try again."));
    }
  };

  const confirmUnlink = (provider: ProviderName) => {
    haptics.warning();
    const label = PROVIDER_COPY.providerLabel[provider];
    Alert.alert(`${PROVIDER_COPY.unlink} ${label}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: PROVIDER_COPY.unlink, style: 'destructive', onPress: () => void unlink(provider) },
    ]);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        {PROVIDER_COPY.methodsTitle}
      </Text>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Ionicons name="key-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <Text style={styles.rowTitle}>{PROVIDER_COPY.password}</Text>
        <Text style={styles.rowHint}>{state.hasPassword ? 'Set' : PROVIDER_COPY.passwordNotSet}</Text>
      </View>
      {ROW_PROVIDERS.map((p) => {
        const identity = state.identities.find((i) => i.provider === p);
        const label = PROVIDER_COPY.providerLabel[p];
        // Unconfigured providers show nothing, and Apple is never offered for linking on Android.
        // A linked Apple row stays, with Unlink only.
        if (!identity && !offered.includes(p)) return null;
        if (identity) {
          const onlyMethod = methodCount <= 1;
          return (
            <View key={p} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{label}</Text>
                <Text style={styles.rowHint}>
                  {identity.isPrivateEmail ? PROVIDER_COPY.privateRelay : (identity.email ?? PROVIDER_COPY.linked(label))}
                </Text>
                {onlyMethod ? <Text style={styles.rowHint}>{PROVIDER_COPY.lastMethod}</Text> : null}
              </View>
              <AppPressable
                style={[styles.action, onlyMethod && styles.actionDisabled]}
                onPress={() => confirmUnlink(p)}
                disabled={onlyMethod}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`${PROVIDER_COPY.unlink} ${label}`}
                accessibilityState={{ disabled: onlyMethod }}
              >
                <Text style={styles.actionText}>{PROVIDER_COPY.unlink}</Text>
              </AppPressable>
            </View>
          );
        }
        return (
          <View key={p} style={styles.linkRow}>
            <Text style={styles.rowTitle}>{label}</Text>
            <ProviderButtons mode="link" only={[p]} onCredential={link} />
          </View>
        );
      })}
      {message ? (
        <Text style={styles.ok} accessibilityLiveRegion="polite">
          {message}
        </Text>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {reauthDialog}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
    paddingBottom: t.spacing[3],
  },
  title: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  linkRow: {
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
  },
  rowIcon: { width: 24, alignItems: 'center' },
  rowBody: { flex: 1, gap: t.spacing[1] },
  rowTitle: { ...typeStyle('body'), color: t.colors.text.primary },
  rowHint: { ...typeStyle('caption'), color: t.colors.text.secondary },
  action: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  actionDisabled: { opacity: 0.4 },
  actionText: { ...typeStyle('label'), color: t.colors.text.primary },
  ok: { ...typeStyle('caption'), color: t.colors.status.verified, paddingHorizontal: t.spacing[4] },
  error: { ...typeStyle('caption'), color: t.colors.text.danger, paddingHorizontal: t.spacing[4] },
}));
