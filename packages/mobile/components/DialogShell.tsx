import type { ReactNode } from 'react';
import { Modal, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { makeStyles } from '../hooks/useTokens';

/**
 * Shared shell for centered core-RN dialogs: fade <Modal>, scrim, a sibling
 * backdrop and the accessibilityViewIsModal card. The caller owns card sizing
 * and layout through `cardStyle`.
 */
export interface DialogShellProps {
  visible: boolean;
  onClose: () => void;
  cardStyle: StyleProp<ViewStyle>;
  children: ReactNode;
}

export default function DialogShell({ visible, onClose, cardStyle, children }: DialogShellProps) {
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.scrim}>
        {/* A sibling backdrop avoids Pressable grouping the entire dialog into
            one screen-reader target. */}
        <Pressable style={styles.backdrop} onPress={onClose} accessible={false} />
        <View style={cardStyle} accessibilityViewIsModal>
          {children}
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
}));
