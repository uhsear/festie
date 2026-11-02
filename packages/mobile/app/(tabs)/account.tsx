import { Fragment, useCallback, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert, RefreshControl, Modal, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useMobilePush } from '../../hooks/useMobilePush';
import { useAuth } from '@festie/shared/hooks';
import { buildSupportMailto } from '@festie/shared/utils';
import {
  ACCOUNT_COPY,
  ACCOUNT_SECTIONS,
  COPY,
  SUPPORT_EMAIL,
  SUPPORT_URL_TERMS,
  THEME_MODE_OPTIONS,
} from '@festie/shared/constants';
import type { AccountSectionId } from '@festie/shared/constants';
import { themeModeOf, useAuthStore, useNotificationPrefsStore, useUIStore } from '@festie/shared/stores';
import ScreenHeader from '../../components/ScreenHeader';
import { CONCEPT_IONICON } from '../../lib/conceptIcons';
import AppPressable from '../../components/AppPressable';
import SectionLabel from '../../components/SectionLabel';
import AccountIdentityCard from '../../components/AccountIdentityCard';
import AppSwitch from '../../components/AppSwitch';
import { LowPowerToggle } from '../../components/LowPowerControls';
import AccountDisplayNameSection from '../../components/AccountDisplayNameSection';
import AccountPaymentHandlesSection from '../../components/AccountPaymentHandlesSection';
import AccountPublicScheduleSection from '../../components/AccountPublicScheduleSection';
import AccountPasswordSection from '../../components/AccountPasswordSection';
import AccountEmailVerifySection from '../../components/AccountEmailVerifySection';
import AccountEmailSection from '../../components/AccountEmailSection';
import AccountDevicesSection from '../../components/AccountDevicesSection';
import FirstRunIntro from '../../components/FirstRunIntro';
import AccountNotificationsSection from '../../components/AccountNotificationsSection';
import AccountNotificationPrefsSection from '../../components/AccountNotificationPrefsSection';
import AccountHistorySection from '../../components/AccountHistorySection';
import AccountDataSection from '../../components/AccountDataSection';
import AccountDangerSection from '../../components/AccountDangerSection';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';
import { useHaptics } from '../../hooks/useHaptics';

/**
 * Account screen — mirrors packages/web/src/routes/account.tsx.
 *
 * Renders ACCOUNT_SECTIONS in order (the same list web renders), so the two
 * pages cannot drift. Above the list sits the identity card, which owns the one
 * avatar (tap to change, Remove photo when set).
 *
 * Display-name change and account deletion are wired to platform-neutral shared
 * actions (authStore.updateDisplayName / authStore.deleteAccount) via dedicated
 * sections. The username is the permanent @handle and is not user-editable.
 *
 * Data export (GDPR) is wired via AccountDataSection (GET /account/export →
 * expo-file-system + expo-sharing).
 *
 * Push notifications are wired via AccountNotificationsSection (FCM token →
 * POST /notifications/token). Requires a real build — Expo Go can't obtain an
 * FCM device token.
 *
 * Security holds the email (add or change), the verify nudge, the password
 * form and the signed-in devices list.
 *
 * Help and legal replays the first-run intro in a modal, opens a support mail
 * draft with the app version, update id and device, and links Terms, Privacy
 * and the third-party notices. The footer shows the version and OTA update id.
 *
 * Theme / display is intentionally not built — it's not a web feature either.
 */
export default function AccountScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const push = useMobilePush();
  const haptics = useHaptics();
  // Bottom inset keeps the Danger Zone clear of the iPhone home indicator.
  const insets = useSafeAreaInsets();

  // Admin entry is gated on the derived isAdmin flag (role-based).
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const user = useAuthStore((s) => s.user);
  // Logout is exposed via the shared useAuth hook per the contract.
  const { logout } = useAuth();

  // Theme choice: persisted device preference. `theme` is what is painted;
  // themeModeOf adds the "Match system" state on top of it.
  const theme = useUIStore((s) => s.theme);
  const followSystemTheme = useUIStore((s) => s.followSystemTheme);
  const themeMode = themeModeOf({ theme, followSystemTheme });
  const setThemeMode = useUIStore((s) => s.setThemeMode);
  const hapticsEnabled = useUIStore((s) => s.hapticsEnabled);
  const setHapticsEnabled = useUIStore((s) => s.setHapticsEnabled);
  // The binary forces dark until app.json userInterfaceStyle is 'automatic' (P8), so
  // the OS scheme cannot be read before that. Hide "Match system" until then.
  const canMatchSystem = Constants.expoConfig?.userInterfaceStyle === 'automatic';
  const offlineMode = useUIStore((s) => s.offlineMode);

  const [loggingOut, setLoggingOut] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  // Pull-to-refresh: a bump signal re-pulls the History card, and we reload
  // notification prefs in parallel so a swipe refreshes everything live.
  const [refreshing, setRefreshing] = useState(false);
  const [historyReload, setHistoryReload] = useState(0);

  const appVersion = Constants.expoConfig?.version ?? null;
  const versionText = appVersion
    ? Updates.updateId && !Updates.isEmbeddedLaunch
      ? `v${appVersion} · update ${Updates.updateId.slice(0, 8)}`
      : `v${appVersion}`
    : null;

  const contactSupport = () => {
    haptics.tap();
    const device = [Device.manufacturer, Device.modelName, Platform.OS, Device.osVersion].filter(Boolean).join(' ');
    const url = buildSupportMailto({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      version: versionText ?? 'unknown',
      device,
      username: user?.username,
    });
    Linking.openURL(url).catch(() => {
      Alert.alert(ACCOUNT_COPY.contactSupport, ACCOUNT_COPY.contactSupportNoMail(SUPPORT_EMAIL));
    });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptics.tap();
    setHistoryReload((n) => n + 1);
    try {
      // checkSession refreshes user.emailVerified, which only changes on /auth/me.
      await Promise.all([
        useAuthStore.getState().checkSession(),
        user ? useNotificationPrefsStore.getState().loadPrefs() : Promise.resolve(),
      ]);
    } catch {
      // best-effort refresh — the History card surfaces its own error/retry.
    } finally {
      setRefreshing(false);
    }
  }, [haptics, user]);

  const confirmLogout = () => {
    haptics.warning();
    Alert.alert(COPY.auth.signOut, COPY.auth.signOutConfirm, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: COPY.auth.signOut,
        style: 'destructive',
        onPress: () => void handleLogout(),
      },
    ]);
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      router.replace('/(auth)/login');
    } catch {
      // logout clears local state even if the network call fails; still route out.
      router.replace('/(auth)/login');
    } finally {
      setLoggingOut(false);
    }
  };

  const go = (path: '/wrap' | '/privacy' | '/admin') => {
    haptics.tap();
    router.push(path);
  };

  const body: Record<AccountSectionId, React.ReactNode> = {
    account: (
      <>
        <AccountDisplayNameSection />
        <AccountEmailSection />
        <AccountEmailVerifySection />
        <AccountPasswordSection />
        <AccountDevicesSection />
        <AccountPaymentHandlesSection />
      </>
    ),
    notifications: (
      <>
        <AccountNotificationsSection push={push} />
        <AccountNotificationPrefsSection pushOn={push.registered} />
      </>
    ),
    privacy: <AccountPublicScheduleSection />,
    offline: (
      <>
        <LowPowerToggle />
        <AccountDataSection />
      </>
    ),
    appearance: (
      <View style={styles.card} accessibilityRole="radiogroup">
        {THEME_MODE_OPTIONS.filter((o) => o.value !== 'system' || canMatchSystem).map((o) => {
          const checked = themeMode === o.value;
          return (
            <AppPressable
              key={o.value}
              style={styles.row}
              onPress={() => {
                haptics.select();
                setThemeMode(o.value);
              }}
              activeOpacity={0.7}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={o.label}
              accessibilityHint={o.hint}
              testID={o.value === 'daylight' ? 'daylight-switch' : `theme-${o.value}`}
            >
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{o.label}</Text>
                <Text style={styles.rowHint} numberOfLines={3}>
                  {o.hint}
                </Text>
              </View>
              {checked ? <Ionicons name="checkmark" size={20} color={t.colors.accent.aqua} /> : null}
            </AppPressable>
          );
        })}
        <View style={styles.row}>
          <View style={styles.rowIcon}>
            <Ionicons
              name={hapticsEnabled ? 'phone-portrait' : 'phone-portrait-outline'}
              size={20}
              color={hapticsEnabled ? t.colors.accent.aqua : t.colors.text.secondary}
            />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>Vibration</Text>
            <Text style={styles.rowHint} numberOfLines={3}>
              Taps, saves and clashes
            </Text>
          </View>
          <AppSwitch
            value={hapticsEnabled}
            onValueChange={(v) => {
              setHapticsEnabled(v);
              haptics.select();
            }}
            accessibilityLabel="Vibration"
            accessibilityState={{ checked: hapticsEnabled }}
            testID="haptics-switch"
          />
        </View>
        <Text style={[styles.rowHint, styles.motionNote]}>{ACCOUNT_COPY.motionNote}</Text>
      </View>
    ),
    festivals: (
      <>
        <View style={styles.card}>
          <LinkRow
            icon={CONCEPT_IONICON.wrap}
            title={COPY.wrap.name}
            hint="Your stats & top sets after the festival"
            onPress={() => go('/wrap')}
            accessibilityLabel="Open your Festival Wrap"
          />
        </View>
        {/* History — cross-festival year-over-year (M3) */}
        <AccountHistorySection refreshSignal={historyReload} />
      </>
    ),
    help: (
      <View style={styles.card}>
        <LinkRow
          icon="play-circle-outline"
          title={ACCOUNT_COPY.howFestieWorks}
          hint={ACCOUNT_COPY.howFestieWorksHint}
          onPress={() => {
            haptics.tap();
            setShowIntro(true);
          }}
          accessibilityLabel={ACCOUNT_COPY.howFestieWorks}
        />
        <LinkRow
          icon="mail-outline"
          title={ACCOUNT_COPY.contactSupport}
          hint={SUPPORT_EMAIL}
          onPress={contactSupport}
          accessibilityLabel={ACCOUNT_COPY.contactSupport}
        />
        <LinkRow
          icon="document-text-outline"
          title={ACCOUNT_COPY.terms}
          onPress={() => {
            haptics.tap();
            void Linking.openURL(SUPPORT_URL_TERMS);
          }}
          accessibilityLabel={ACCOUNT_COPY.terms}
        />
        <LinkRow
          icon="shield-checkmark-outline"
          title={ACCOUNT_COPY.privacyTitle}
          hint={ACCOUNT_COPY.privacyHint}
          onPress={() => go('/privacy')}
          accessibilityLabel="Open the privacy policy"
        />
        <LinkRow
          icon="document-text-outline"
          title="Third-party notices"
          hint="Open-source licences"
          onPress={() => {
            haptics.tap();
            void WebBrowser.openBrowserAsync('https://festie.us/third-party-notices.txt');
          }}
          accessibilityLabel="Open the third-party notices"
        />
      </View>
    ),
    // Admin — only visible to administrators (read-only dashboard)
    admin: (
      <View style={styles.card}>
        <LinkRow
          icon="speedometer-outline"
          iconTint={t.colors.accent.aqua}
          title={ACCOUNT_COPY.adminTitle}
          hint={ACCOUNT_COPY.adminHint}
          onPress={() => go('/admin')}
          accessibilityLabel="Open the admin dashboard"
        />
      </View>
    ),
    signOut: (
      <View style={styles.card}>
        <AppPressable
          style={styles.row}
          onPress={confirmLogout}
          disabled={loggingOut}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Sign out of your account"
          accessibilityState={{ disabled: loggingOut }}
        >
          <View style={styles.rowIcon}>
            <Ionicons name="log-out-outline" size={20} color={t.colors.text.danger} />
          </View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, styles.dangerText]}>{COPY.auth.signOut}</Text>
          </View>
          {loggingOut ? (
            <ActivityIndicator size="small" color={t.colors.text.danger} />
          ) : (
            <Ionicons name="chevron-forward" size={18} color={t.colors.text.placeholder} />
          )}
        </AppPressable>
      </View>
    ),
    danger: <AccountDangerSection onDeleted={() => router.replace('/(auth)/login')} />,
  };

  return (
    // KAV is dropped: behavior='padding' is a no-op on Android, and on iOS it
    // doesn't scroll the focused field into view when it's deep in the list.
    // automaticallyAdjustKeyboardInsets on the ScrollView handles both platforms
    // correctly (same pattern as app/set/[setId].tsx).
    <View style={styles.container} testID="account-screen">
      <ScreenHeader title={ACCOUNT_COPY.title} subtitle={ACCOUNT_COPY.subtitle} icon="person-circle-outline" />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(t.spacing[6], insets.bottom + t.spacing[2]) }]}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={t.colors.accent.aqua}
            colors={[t.colors.accent.aqua]}
            progressBackgroundColor={t.colors.bg.secondary}
          />
        }
      >
        <AccountIdentityCard />

        {offlineMode ? (
          <Text style={styles.offlineNote} accessibilityRole="alert">
            You're offline. Settings need a connection.
          </Text>
        ) : null}

        {ACCOUNT_SECTIONS.filter((s) => !('adminOnly' in s) || isAdmin).map((s) => (
          <Fragment key={s.id}>
            {s.label ? <SectionLabel>{s.label}</SectionLabel> : null}
            {body[s.id]}
          </Fragment>
        ))}

        {/* App version footer — a quiet build stamp for support/debugging. */}
        {versionText ? (
          <Text style={styles.version} accessibilityLabel={ACCOUNT_COPY.versionLine('app', versionText)}>
            {ACCOUNT_COPY.versionLine('app', versionText)}
          </Text>
        ) : null}
      </ScrollView>

      {/* Replays the intro only; the stored first-run flag stays as it is. */}
      <Modal visible={showIntro} animationType="fade" onRequestClose={() => setShowIntro(false)}>
        <FirstRunIntro onDone={() => setShowIntro(false)} />
      </Modal>
    </View>
  );
}

/**
 * A single navigational row inside a card (Festival Wrap, Privacy, Admin).
 * Centralizes the icon + title + hint + chevron + light haptic so the three
 * link rows stay pixel-identical instead of drifting copy-paste.
 */
function LinkRow({
  icon,
  iconTint,
  title,
  hint,
  onPress,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconTint?: string;
  title: string;
  hint?: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const t = useTokens();
  const styles = useStyles();
  return (
    <AppPressable
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={20} color={iconTint ?? t.colors.text.secondary} />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        {hint ? (
          <Text style={styles.rowHint} numberOfLines={3}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.colors.text.placeholder} />
    </AppPressable>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  scroll: {
    // Centered, capped content width so cards don't span edge-to-edge on
    // tablets / large screens. On phones (< 600pt) this is a no-op and the
    // content simply fills the available width.
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[4],
  },
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
  dangerText: {
    color: t.colors.text.danger,
  },
  motionNote: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
  offlineNote: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
  },
  version: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
    marginTop: t.spacing[2],
  },
}));
