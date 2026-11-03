import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useInboxStore, selectInboxUnread } from '@festie/shared/stores';
import { INBOX_COPY, inboxBadgeLabel } from '@festie/shared/constants';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import AppPressable from './AppPressable';

/** Header bell: opens the inbox and shows the unread count. Renders nothing for guests. */
export default function InboxBell() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const unread = useInboxStore(selectInboxUnread);
  if (!user) return null;
  const label = inboxBadgeLabel(unread);
  return (
    <AppPressable
      onPress={() => router.push('/inbox')}
      accessibilityRole="button"
      accessibilityLabel={unread > 0 ? INBOX_COPY.bellLabelUnread(unread) : INBOX_COPY.bellLabel}
      style={styles.hit}
      borderless
    >
      <View>
        <Ionicons name="notifications-outline" size={24} color={t.colors.text.secondary} />
        {label ? (
          <View
            style={styles.countBadge}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Text style={styles.countBadgeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {label}
            </Text>
          </View>
        ) : null}
      </View>
    </AppPressable>
  );
}

const useStyles = makeStyles((t) => ({
  hit: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    paddingHorizontal: t.spacing[1],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
    alignItems: 'center',
    justifyContent: 'center',
  },
  countBadgeText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
}));
