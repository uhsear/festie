import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../Button';
import { makeStyles, typeStyle } from '../../hooks/useTokens';

/**
 * Bottom selection bar for admin lists. Renders nothing when nothing is
 * selected. Mirrors the web SelectionBar props.
 */
export interface SelectionBarProps {
  count: number;
  actionLabel: string;
  onAction: () => void;
  onClear: () => void;
  busy?: boolean;
  note?: string | null;
}

export default function SelectionBar({ count, actionLabel, onAction, onClear, busy = false, note }: SelectionBarProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  if (count === 0) return null;

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 12) }]}
      accessibilityRole="toolbar"
      accessibilityLabel="Selection"
    >
      <View style={styles.row}>
        <Text style={styles.count}>{count} selected</Text>
        <Button label="Clear" variant="ghost" size="sm" onPress={onClear} disabled={busy} style={styles.touch} />
        <Button
          label={actionLabel}
          variant="danger"
          size="sm"
          onPress={onAction}
          loading={busy}
          style={styles.touch}
        />
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.colors.bg.secondary,
    borderTopWidth: 1,
    borderTopColor: t.colors.border.light,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    gap: t.spacing[1],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  count: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
    flex: 1,
  },
  touch: {
    minHeight: 44,
  },
  note: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
}));
