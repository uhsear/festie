import { useEffect } from 'react';
import { AccessibilityInfo, Alert, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore, useFollowStore, useUIStore } from '@festie/shared/stores';
import { DISCOVER_COPY, GUEST_PROMPT_COPY } from '@festie/shared/constants';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

interface Props {
  festivalId: string;
  festivalName: string;
  style?: StyleProp<ViewStyle>;
}

const COPY = DISCOVER_COPY.follow;

/** Follow toggle for a festival. A guest gets a prompt to sign in instead. */
export default function FollowButton({ festivalId, festivalName, style }: Props) {
  const styles = useStyles();
  const router = useRouter();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const loaded = useFollowStore((s) => s.loaded);
  const following = useFollowStore((s) => s.festivalIds.includes(festivalId));

  useEffect(() => {
    if (user && !loaded) useFollowStore.getState().load().catch(() => {});
  }, [user, loaded]);

  const onPress = async () => {
    haptics.select();
    if (!user) {
      Alert.alert(GUEST_PROMPT_COPY.follow.title(festivalName), GUEST_PROMPT_COPY.follow.message, [
        { text: COPY.notNow, style: 'cancel' },
        { text: GUEST_PROMPT_COPY.signIn, onPress: () => router.push('/(auth)/login') },
        { text: GUEST_PROMPT_COPY.createAccount, onPress: () => router.push('/(auth)/register') },
      ]);
      return;
    }
    const on = !following;
    try {
      await useFollowStore.getState().setFollowing(festivalId, on);
      const message = on ? COPY.followedToast(festivalName) : COPY.unfollowedToast(festivalName);
      useUIStore.getState().showToast(message, { kind: 'info' });
      AccessibilityInfo.announceForAccessibility(message);
    } catch {
      useUIStore.getState().showToast(COPY.error, { kind: 'error' });
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, following && styles.buttonOn, style]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
      accessibilityLabel={following ? COPY.unfollowA11y(festivalName) : COPY.followA11y(festivalName)}
    >
      <Text style={[styles.text, following && styles.textOn]} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {following ? COPY.following : COPY.follow}
      </Text>
    </TouchableOpacity>
  );
}

const useStyles = makeStyles((t) => ({
  button: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  buttonOn: {
    backgroundColor: t.colors.aquaAlpha[12],
    borderColor: t.colors.aquaAlpha[70],
  },
  text: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  textOn: {
    color: t.colors.accent.aqua,
  },
}));
