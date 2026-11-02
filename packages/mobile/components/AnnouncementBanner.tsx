import { useEffect } from 'react';
import { AccessibilityInfo, AppState, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAnnouncementStore, useFestivalDataStore } from '@festie/shared/stores';
import { announcementTarget, pickBannerAnnouncement } from '@festie/shared/utils';
import { ANNOUNCEMENT_COPY } from '@festie/shared/constants';
import { makeStyles, typeStyle, useTokens, iconSize } from '../hooks/useTokens';
import { pushTargetHref } from '../lib/pushRoutes';
import AppPressable from './AppPressable';

interface AnnouncementBannerProps {
  /** Pad for the status bar. False when a bar above (Offline or SOS) already does. */
  padTop: boolean;
  /** Reports whether the banner is showing, so the chrome applies the top inset once. */
  onActiveChange?: (active: boolean) => void;
}

/**
 * App-wide "From Festie" banner for admin announcements, mounted at the root under
 * the SOS banner. Shows the newest urgent (else newest) announcement the user has
 * not dismissed on this device. Reloads when the festival changes and when the app
 * returns to the foreground.
 */
export default function AnnouncementBanner({ padTop, onActiveChange }: AnnouncementBannerProps) {
  const t = useTokens();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const festivalId = useFestivalDataStore((st) => st.currentFestivalId);
  const items = useAnnouncementStore((st) => st.items);
  const dismissed = useAnnouncementStore((st) => st.dismissed);
  const load = useAnnouncementStore((st) => st.load);
  const dismiss = useAnnouncementStore((st) => st.dismiss);

  useEffect(() => {
    void load(festivalId);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load(festivalId);
    });
    return () => sub.remove();
  }, [festivalId, load]);

  const a = pickBannerAnnouncement(items, dismissed);
  const active = a !== null;
  const id = a?.id;
  const kicker = a ? ANNOUNCEMENT_COPY.banner.kicker(a.severity) : '';
  const label = a ? ANNOUNCEMENT_COPY.banner.label(kicker, a.title, a.body) : '';

  useEffect(() => {
    onActiveChange?.(active);
    return () => onActiveChange?.(false);
  }, [active, onActiveChange]);

  // Announce once per new id, not on every re-render.
  useEffect(() => {
    if (id) AccessibilityInfo.announceForAccessibility(label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!a) return null;
  const urgent = a.severity === 'urgent';

  return (
    <View
      style={[
        s.banner,
        { borderColor: urgent ? t.colors.text.danger : t.colors.accent.aqua, paddingTop: (padTop ? insets.top : 0) + t.spacing[2] },
      ]}
    >
      {/* Label the text column, not the row, so iOS keeps Open and Dismiss focusable. */}
      <View style={s.body} accessible accessibilityRole="summary" accessibilityLabel={label}>
        <View style={s.kickerRow}>
          {urgent ? <Ionicons name="warning-outline" size={iconSize.sm} color={t.colors.text.danger} /> : null}
          <Text style={[s.kicker, urgent && { color: t.colors.text.danger }]}>{kicker}</Text>
        </View>
        <Text style={s.title}>{a.title}</Text>
        <Text style={s.text}>{a.body}</Text>
      </View>
      {a.screen !== 'home' ? (
        <AppPressable
          style={s.action}
          onPress={() => {
            router.push(pushTargetHref(announcementTarget(a)));
            dismiss(a.id);
          }}
          accessibilityRole="button"
          accessibilityLabel={ANNOUNCEMENT_COPY.banner.open}
        >
          <Text style={s.actionText}>{ANNOUNCEMENT_COPY.banner.open}</Text>
        </AppPressable>
      ) : null}
      <AppPressable
        style={s.action}
        onPress={() => dismiss(a.id)}
        accessibilityRole="button"
        accessibilityLabel={ANNOUNCEMENT_COPY.banner.dismiss}
      >
        <Ionicons name="close" size={iconSize.md} color={t.colors.text.primary} />
      </AppPressable>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
    minHeight: 48,
    backgroundColor: t.colors.bg.secondary,
    borderBottomWidth: 2,
  },
  body: {
    flex: 1,
    gap: t.spacing[1],
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  kicker: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  title: {
    ...typeStyle('label', 700),
    color: t.colors.text.primary,
  },
  text: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  action: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
}));
