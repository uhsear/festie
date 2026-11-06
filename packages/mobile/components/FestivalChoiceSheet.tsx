import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import Button from './Button';

interface FestivalChoiceSheetProps {
  visible: boolean;
  title: string;
  message?: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Scrolling festival list with Cancel. Alert.alert caps Android at 3 buttons, so it cannot list festivals. */
export default function FestivalChoiceSheet({ visible, title, message, options, onSelect, onClose }: FestivalChoiceSheetProps) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Cancel" />
        <View style={[styles.sheet, { paddingBottom: t.spacing[5] + insets.bottom }]} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {title}
          </Text>
          {message ? (
            <Text style={styles.message} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {message}
            </Text>
          ) : null}
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {options.map((o) => (
              <Pressable
                key={o.id}
                style={styles.row}
                onPress={() => onSelect(o.id)}
                accessibilityRole="button"
                accessibilityLabel={o.label}
              >
                <Text style={styles.rowText} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: t.colors.shade[9] },
  sheet: {
    gap: t.spacing[3],
    padding: t.spacing[5],
    maxHeight: '85%',
    borderTopLeftRadius: t.radii.default,
    borderTopRightRadius: t.radii.default,
    backgroundColor: t.colors.bg.secondary,
  },
  title: { ...typeStyle('title'), color: t.colors.text.primary },
  message: { ...typeStyle('caption'), color: t.colors.text.secondary },
  list: { flexGrow: 0 },
  listContent: { gap: t.spacing[2] },
  row: {
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.input,
  },
  rowText: { ...typeStyle('body'), color: t.colors.text.primary },
}));
