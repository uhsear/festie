import { useCallback, useRef, useState, type ReactElement } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable } from 'react-native';
import { REAUTH_COPY } from '@festie/shared/services';
import { makeStyles, typeStyle } from '../../hooks/useTokens';
import { LabeledTextInput } from './AdminFields';

/**
 * Password re-check prompt for gated admin actions. `askPassword()` opens the
 * dialog and resolves with the typed password, or null on cancel. The caller
 * renders `reauthDialog` once. Core <Modal> only, so it stays OTA-able.
 */
export function useReauthPrompt(): {
  askPassword: () => Promise<string | null>;
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

  const reauthDialog = (
    <ReauthDialog
      visible={visible}
      password={password}
      onChangePassword={setPassword}
      onConfirm={() => finish(password)}
      onCancel={() => finish(null)}
    />
  );

  return { askPassword, reauthDialog };
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
