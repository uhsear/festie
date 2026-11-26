import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useAuthStore, useLiveLocationStore, useUIStore } from '@festie/shared/stores';
import { SOS_CONTROL } from '@festie/shared/constants';
import { duration, durationEffects, elevation } from '@festie/shared/tokens';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useSosRaise } from '../hooks/useSosRaise';

export const SOS_CONTROL_SIZE = 64;
const SIZE = SOS_CONTROL_SIZE;
const RING_R = 29;
const RING_LENGTH = 2 * Math.PI * RING_R;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => mounted && setEnabled(on))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return enabled;
}

interface SosControlProps {
  /** The crew the SOS goes to. Renders nothing without one, or for a guest. */
  crewId: string | null | undefined;
  /** Space the screen already gives to a native tab bar that overlays content. */
  bottomInset?: number;
}

/**
 * The one SOS control: a round press-and-hold button pinned bottom-right. A press that lasts
 * SOS_CONTROL.holdMs fills the ring and opens the confirm. With a screen reader on, a double-tap
 * opens the same confirm and needs no hold. It hides while your own SOS is live.
 */
export default function SosControl({ crewId, bottomInset = 0 }: SosControlProps) {
  const t = useTokens();
  const s = useStyles();
  const reduceMotion = useReduceMotion();
  const screenReader = useScreenReaderEnabled();
  const userId = useAuthStore((st) => st.user?.id);
  const activeSosList = useLiveLocationStore((st) => st.activeSosList);
  const crewSos = useMemo(() => activeSosList.filter((e) => e.crewId === crewId), [activeSosList, crewId]);
  const { confirmRaise, raising } = useSosRaise(crewId ?? null);

  const hold = useSharedValue(0);
  const glow = useSharedValue(0);
  const alerting = crewSos.length > 0;
  useEffect(() => {
    if (!alerting || reduceMotion) {
      glow.value = 0;
      return;
    }
    glow.value = withRepeat(withTiming(1, { duration: duration.pulse, easing: Easing.out(Easing.cubic) }), -1, true);
  }, [alerting, reduceMotion, glow]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING_LENGTH * (1 - hold.value) }));
  const alertStyle = useAnimatedStyle(() => {
    const v = reduceMotion ? 0.5 : glow.value;
    return { opacity: 0.15 + v * 0.35, transform: [{ scale: 1 + v * 0.18 }] };
  });

  if (!userId || !crewId || crewSos.some((e) => e.userId === userId)) return null;

  const release = () => {
    cancelAnimation(hold);
    hold.value = reduceMotion ? 0 : withTiming(0, { duration: durationEffects.fast });
  };

  return (
    <View style={[s.wrap, { bottom: bottomInset + t.spacing[5] }]} pointerEvents="box-none">
      {alerting ? <Animated.View pointerEvents="none" style={[s.alertRing, alertStyle]} /> : null}
      <Pressable
        testID="sos-control"
        style={s.button}
        delayLongPress={SOS_CONTROL.holdMs}
        onPressIn={() => {
          hold.value = reduceMotion ? 1 : withTiming(1, { duration: SOS_CONTROL.holdMs, easing: Easing.linear });
        }}
        onPressOut={release}
        onLongPress={confirmRaise}
        onPress={() => {
          // A screen reader's double-tap is a plain press: open the confirm, no hold needed.
          if (screenReader) confirmRaise();
          else useUIStore.getState().showToast(SOS_CONTROL.tapHint);
        }}
        disabled={raising}
        accessibilityRole="button"
        accessibilityLabel={SOS_CONTROL.name}
        accessibilityHint={SOS_CONTROL.hint}
        accessibilityState={{ disabled: raising, busy: raising }}
      >
        <Svg width={SIZE} height={SIZE} viewBox="0 0 64 64" style={s.ring} pointerEvents="none">
          <AnimatedCircle
            cx={32}
            cy={32}
            r={RING_R}
            fill="none"
            stroke={t.colors.text.onAccent}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            animatedProps={ringProps}
            rotation={-90}
            origin="32, 32"
          />
        </Svg>
        {raising ? (
          <ActivityIndicator color={t.colors.text.onAccent} />
        ) : (
          <>
            <Ionicons name="alert-circle" size={t.iconSize.md} color={t.colors.text.onAccent} />
            <Text style={s.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              SOS
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // The wrapper is the only absolutely-positioned node, so the button never collapses to 0x0
  // on Android New Architecture.
  wrap: {
    position: 'absolute',
    right: t.spacing[4],
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertRing: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    left: -8,
    right: -8,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.coralStrong,
  },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accent.coralStrong,
    ...elevation.low,
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  label: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
}));
