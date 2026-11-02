import { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { useSignedInDevices, deviceTitle, deviceSubtitle, type SignedInDevice } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { useUIStore } from '@festie/shared/stores';
import Button from './Button';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Signed-in devices for the Account screen. The list loads only when the card
 * opens (GET /auth/sessions); each other device can be signed out, or all of
 * them at once (DELETE /auth/sessions).
 */
export default function AccountDevicesSection() {
  const t = useTokens();
  const offlineMode = useUIStore((s) => s.offlineMode);
  const styles = useStyles();
  const haptics = useHaptics();
  const [open, setOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { devices, loading, error, reload, signOut, signOutOthers } = useSignedInDevices(open);

  const run = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
      haptics.success();
    } catch (err) {
      haptics.warning();
      setActionError(mapErrorToUserMessage(err, ACCOUNT_COPY.signOutFailed));
    }
  };

  const confirmSignOutOthers = () => {
    Alert.alert(ACCOUNT_COPY.signOutOthersTitle, ACCOUNT_COPY.signOutOthersBody, [
      { text: 'Cancel', style: 'cancel' },
      { text: ACCOUNT_COPY.signOutOthersConfirm, style: 'destructive', onPress: () => void run(signOutOthers) },
    ]);
  };

  const renderRow = (d: SignedInDevice) => (
    <View key={d.id} style={styles.deviceRow}>
      <View style={styles.rowBody}>
        <Text style={styles.deviceTitle} numberOfLines={1}>
          {deviceTitle(d)}
        </Text>
        <Text style={styles.rowHint}>{deviceSubtitle(d)}</Text>
      </View>
      {!d.current ? (
        <Button
          label={ACCOUNT_COPY.signOutDevice}
          variant="secondary"
          size="sm"
          disabled={offlineMode}
          onPress={() => void run(() => signOut(d.id))}
          accessibilityLabel={`${ACCOUNT_COPY.signOutDevice} ${deviceTitle(d)}`}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => {
          setActionError(null);
          setOpen((o) => !o);
        }}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={ACCOUNT_COPY.devicesTitle}
        accessibilityHint={ACCOUNT_COPY.devicesHint}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="phone-portrait-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{ACCOUNT_COPY.devicesTitle}</Text>
          <Text style={styles.rowHint}>{ACCOUNT_COPY.devicesHint}</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.placeholder} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.body}>
          {loading && devices.length === 0 ? (
            <ActivityIndicator color={t.colors.accent.aqua} />
          ) : error ? (
            <View style={styles.errorRow}>
              <Text style={styles.error}>{error}</Text>
              <TouchableOpacity onPress={() => void reload()} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {devices.map(renderRow)}
              {devices.length === 1 ? <Text style={styles.rowHint}>{ACCOUNT_COPY.onlyThisDevice}</Text> : null}
              {devices.length > 1 ? (
                <TouchableOpacity
                  onPress={confirmSignOutOthers}
                  disabled={offlineMode}
                  accessibilityRole="button"
                  style={styles.othersButton}
                >
                  <Text style={styles.danger}>{ACCOUNT_COPY.signOutOthers}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
          {actionError ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {actionError}
            </Text>
          ) : null}
        </View>
      ) : null}
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  body: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    minHeight: 44,
  },
  deviceTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[3],
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    flexShrink: 1,
  },
  link: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  othersButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  danger: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
}));
