import { useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { FullWindowOverlay } from 'react-native-screens';
import { useUIStore, type Toast } from '@festie/shared/stores';
import { durationEffects, durationSpatial } from '@festie/shared/tokens';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { haptic } from '../hooks/useHaptics';

const MAX_VISIBLE = 3;
// Clears the tab bar.
const TAB_BAR_CLEARANCE = 72;

function ToastCard({ toast, reduceMotion }: { toast: Toast; reduceMotion: boolean }) {
  const t = useTokens();
  const styles = useStyles();
  const dismissToast = useUIStore((s) => s.dismissToast);
  const accent = {
    info: t.colors.accent.aqua,
    success: t.colors.accent.green,
    warning: t.colors.accent.amber,
    // Amber, not coral: coral is for danger and SOS only.
    error: t.colors.accent.amber,
  }[toast.kind];

  // Mount-only: announce and buzz once when the toast appears.
  useEffect(() => {
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.message);
    if (toast.kind === 'error' || toast.kind === 'warning' || toast.kind === 'success') haptic(toast.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The Toaster owns the timer. Never paused: an undo toast must not outlive its delete timer.
  useEffect(() => {
    const id = setTimeout(() => dismissToast(toast.id), toast.durationMs);
    return () => clearTimeout(id);
  }, [toast.id, toast.durationMs, dismissToast]);

  const { onUndo } = toast;
  return (
    <Animated.View
      entering={reduceMotion ? FadeIn.duration(durationEffects.fast) : FadeInDown.duration(durationSpatial.med)}
      exiting={FadeOut.duration(durationEffects.fast)}
      style={[styles.card, { borderLeftColor: accent }]}
      accessibilityRole={toast.kind === 'error' ? 'alert' : undefined}
    >
      <Pressable
        onPress={() => dismissToast(toast.id)}
        style={styles.messageHit}
        accessibilityHint="Dismisses this message"
      >
        <Text style={styles.message}>{toast.message}</Text>
      </Pressable>
      {onUndo ? (
        <Pressable
          onPress={() => {
            onUndo();
            dismissToast(toast.id);
          }}
          style={styles.undo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
        >
          <Text style={styles.undoText}>Undo</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

/** App-wide toast host: renders the last 3 entries of the shared uiStore toast list. */
export default function Toaster() {
  const toasts = useUIStore((s) => s.toasts);
  const bottom = useListBottomInset({ base: TAB_BAR_CLEARANCE });
  const styles = useStyles();
  const reduceMotion = useReduceMotion();
  const visible = toasts.slice(-MAX_VISIBLE);
  const host = (
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={[styles.container, { bottom }]}
    >
      {visible.map((toast) => (
        <ToastCard key={toast.id} toast={toast} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
  // iOS native sheets (the formSheet set screen) cover the root view, so an
  // Undo toast fired from a sheet would sit hidden behind it. The overlay window
  // floats above them and passes touches outside the toasts through.
  return Platform.OS === 'ios' ? <FullWindowOverlay>{host}</FullWindowOverlay> : host;
}

const useStyles = makeStyles((t) => ({
  container: {
    position: 'absolute',
    left: t.spacing[4],
    right: t.spacing[4],
    gap: t.spacing[2],
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingLeft: t.spacing[3],
    paddingRight: t.spacing[2],
    paddingVertical: t.spacing[2],
    minHeight: 48,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: t.colors.border.light,
    // Spec says bg.card, but Stage's bg.card is 65% translucent with no blur, so text under a floating toast bleeds through.
    backgroundColor: t.colors.bg.secondary,
  },
  messageHit: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  message: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  undo: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: t.spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
}));
