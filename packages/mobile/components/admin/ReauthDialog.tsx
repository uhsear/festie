import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Linking, Modal, Platform, View, Text, TouchableOpacity, Pressable } from 'react-native';
import { PROVIDER_COPY } from '@festie/shared/constants';
import { REAUTH_COPY, listIdentities, type ReauthBody } from '@festie/shared/services';
import type { ProviderName } from '@festie/shared/types';
import { makeStyles, typeStyle } from '../../hooks/useTokens';
import ProviderButtons from '../ProviderButtons';
import { LabeledTextInput } from './AdminFields';

const WEB_ACCOUNT_URL = 'https://festie.us/account';

/**
 * Password re-check prompt for gated admin actions. `askPassword()` opens the
 * dialog and resolves with the typed password, or null on cancel. The caller
 * renders `reauthDialog` once. Core <Modal> only, so it stays OTA-able.
 */
export function useReauthPrompt(): {
  askPassword: () => Promise<string | null>;
  /** Password for a password account, a provider token for a provider-only one; null on cancel. */
  ask: () => Promise<string | ReauthBody | null>;
  reauthDialog: ReactElement;
} {
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState('');
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const askPassword = useCallback(() => {
    // A second ask while one is open cancels the first so its caller is not left hanging.
    resolver.current?.(null);
    setPassword('');
    setVisible(true);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = useCallback((value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setVisible(false);
    setPassword('');
  }, []);

  // Non-null while the provider dialog is open: the providers linked to this account.
  const [linked, setLinked] = useState<ProviderName[] | null>(null);
  const providerResolver = useRef<((value: ReauthBody | null) => void) | null>(null);

  const finishProvider = useCallback((value: ReauthBody | null) => {
    providerResolver.current?.(value);
    providerResolver.current = null;
    setLinked(null);
  }, []);

  const ask = useCallback(async (): Promise<string | ReauthBody | null> => {
    let identities: Awaited<ReturnType<typeof listIdentities>> | null = null;
    try {
      identities = await listIdentities();
    } catch {
      // Unknown account type: fall back to the password prompt, which the server still checks.
    }
    if (!identities || identities.hasPassword) return askPassword();
    providerResolver.current?.(null);
    const providers = identities.identities.map((i) => i.provider);
    setLinked(providers);
    return new Promise<ReauthBody | null>((resolve) => {
      providerResolver.current = resolve;
    });
  }, [askPassword]);

  const reauthDialog = (
    <>
      <ReauthDialog
        visible={visible}
        password={password}
        onChangePassword={setPassword}
        onConfirm={() => finish(password)}
        onCancel={() => finish(null)}
      />
      <ProviderReauthDialog linked={linked} onResult={finishProvider} />
    </>
  );

  return { askPassword, ask, reauthDialog };
}

/** Providers this device can use to re-confirm: Apple sign-in does not run in the Android app. */
export function reauthProvidersFor(linked: ProviderName[], platform: string): ProviderName[] {
  return platform === 'android' ? linked.filter((p) => p !== 'apple') : linked;
}

function ProviderReauthDialog({
  linked,
  onResult,
}: {
  linked: ProviderName[] | null;
  onResult: (value: ReauthBody | null) => void;
}) {
  const styles = useStyles();
  const usable = reauthProvidersFor(linked ?? [], Platform.OS);
  const label = usable.map((p) => PROVIDER_COPY.providerLabel[p]).join(' or ');
  return (
    <Modal visible={linked !== null} transparent animationType="fade" onRequestClose={() => onResult(null)} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable style={styles.backdrop} onPress={() => onResult(null)} accessible={false} />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {REAUTH_COPY.title}
          </Text>
          {usable.length > 0 ? (
            <>
              <Text style={styles.message}>{PROVIDER_COPY.reauthProviderBody(label)}</Text>
              <ProviderButtons
                mode="reauth"
                only={usable}
                onCredential={async (provider, body) => {
                  onResult({ provider, idToken: body.idToken, nonce: body.nonce, authorizationCode: body.authorizationCode });
                }}
              />
            </>
          ) : (
            <>
              <Text style={styles.message}>Confirm on festie.us, or set a password first.</Text>
              <TouchableOpacity
                style={[styles.button, styles.confirmButton]}
                onPress={() => void Linking.openURL(WEB_ACCOUNT_URL)}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel="Open festie.us account page"
              >
                <Text style={styles.confirmLabel}>Open festie.us</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity
            style={[styles.button, styles.cancelButton]}
            onPress={() => onResult(null)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelLabel}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

interface ReauthDialogProps {
  visible: boolean;
  password: string;
  onChangePassword: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function ReauthDialog({ visible, password, onChangePassword, onConfirm, onCancel }: ReauthDialogProps) {
  const styles = useStyles();
  const canConfirm = password.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable style={styles.backdrop} onPress={onCancel} accessible={false} />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {REAUTH_COPY.title}
          </Text>
          <Text style={styles.message}>{REAUTH_COPY.body}</Text>
          <LabeledTextInput
            label={REAUTH_COPY.label}
            value={password}
            onChangeText={onChangePassword}
            autoCapitalize="none"
            maxLength={200}
            secureTextEntry
          />
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.confirmButton, !canConfirm && styles.confirmDisabled]}
              onPress={onConfirm}
              disabled={!canConfirm}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={REAUTH_COPY.button}
              accessibilityState={{ disabled: !canConfirm }}
            >
              <Text style={styles.confirmLabel}>{REAUTH_COPY.button}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  scrim: {
    flex: 1,
    backgroundColor: t.colors.shade[10],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: t.spacing[5],
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    padding: t.spacing[5],
    gap: t.spacing[3],
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  message: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  actions: {
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  button: {
    minHeight: 48,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
  },
  cancelButton: {
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  cancelLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  confirmButton: {
    backgroundColor: t.colors.accent.aqua,
  },
  confirmDisabled: {
    opacity: 0.4,
  },
  confirmLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
}));
