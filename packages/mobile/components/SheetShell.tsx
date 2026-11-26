import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { durationEffects, durationSpatial } from '@festie/shared/tokens';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { makeStyles, useTokens } from '../hooks/useTokens';

interface SheetShellProps {
  visible: boolean;
  onClose: () => void;
  backdropLabel: string;
  maxHeight?: DimensionValue;
  keyboardAvoiding?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * Bottom sheet chrome shared by the crew sheets: a fading scrim, a sheet that
 * slides on the token durations, a tap-to-close grabber, safe-area padding.
 * Everything is instant under Reduce Motion.
 *
 * Pan-to-dismiss is not built: react-native-gesture-handler has no JS caller
 * and no root view yet, and registering it may need a native build (paid). The
 * grabber is the close target until that is confirmed.
 */
export default function SheetShell({
  visible,
  onClose,
  backdropLabel,
  maxHeight,
  keyboardAvoiding = false,
  style,
  children,
}: SheetShellProps) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  // animationType "none" removes the Modal the moment `visible` flips, which would cut the
  // exit animations. Keep it mounted for the exit, with the content already unmounted.
  const [exiting, setExiting] = useState(false);
  const wasVisible = useRef(visible);
  useEffect(() => {
    const closed = wasVisible.current && !visible;
    wasVisible.current = visible;
    if (!closed || reduceMotion) return;
    setExiting(true);
    const timer = setTimeout(() => setExiting(false), durationSpatial.med);
    return () => clearTimeout(timer);
  }, [visible, reduceMotion]);

  const content = (
    <>
      <Animated.View
        style={styles.backdrop}
        entering={reduceMotion ? undefined : FadeIn.duration(durationEffects.med)}
        exiting={reduceMotion ? undefined : FadeOut.duration(durationEffects.med)}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={backdropLabel}
        />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { maxHeight, paddingBottom: t.spacing[5] + insets.bottom }, style]}
        entering={reduceMotion ? undefined : SlideInDown.duration(durationSpatial.med)}
        exiting={reduceMotion ? undefined : SlideOutDown.duration(durationSpatial.med)}
        accessibilityViewIsModal
      >
        <Pressable
          style={styles.grabberHit}
          onPress={onClose}
          hitSlop={t.spacing[2]}
          accessibilityRole="button"
          accessibilityLabel={backdropLabel}
        >
          <View style={styles.grabber} />
        </Pressable>
        {children}
      </Animated.View>
    </>
  );
  return (
    <Modal visible={visible || exiting} animationType="none" transparent onRequestClose={onClose}>
      {visible ? (
        keyboardAvoiding ? (
          <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            {content}
          </KeyboardAvoidingView>
        ) : (
          <View style={styles.root}>{content}</View>
        )
      ) : null}
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: t.colors.shade[9],
  },
  sheet: {
    gap: t.spacing[3],
    padding: t.spacing[5],
    borderTopLeftRadius: t.radii.default,
    borderTopRightRadius: t.radii.default,
    backgroundColor: t.colors.bg.secondary,
  },
  grabberHit: {
    alignSelf: 'center',
    paddingVertical: t.spacing[1],
    paddingHorizontal: t.spacing[4],
  },
  grabber: {
    width: t.spacing[8],
    height: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.border.default,
  },
}));
