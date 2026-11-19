import type { ReactNode } from 'react';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

/** Bottom sheet chrome shared by the crew sheets: slide-up modal, tap-to-close scrim, safe-area padding. */
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
  const content = (
    <>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={backdropLabel}
      />
      <View
        style={[styles.sheet, { maxHeight, paddingBottom: t.spacing[5] + insets.bottom }, style]}
        accessibilityViewIsModal
      >
        {children}
      </View>
    </>
  );
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {keyboardAvoiding ? (
        <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {content}
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.root}>{content}</View>
      )}
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
}));
