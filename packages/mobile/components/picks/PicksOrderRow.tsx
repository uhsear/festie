import { View, Text, TouchableOpacity } from 'react-native';
import { type PicksOrder } from '@festie/shared/utils';
import { MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useStyles } from './styles';

interface PicksOrderRowProps {
  order: PicksOrder;
  setOrderHaptic: (next: PicksOrder) => void;
}

export default function PicksOrderRow({
  order,
  setOrderHaptic,
}: PicksOrderRowProps) {
  const styles = useStyles();
  return (
<View style={styles.controlsRow}>
  <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Order sets">
    {(['openers', 'headliners'] as const).map((value) => {
      const active = order === value;
      const label = value === 'openers' ? 'Openers first' : 'Headliners first';
      return (
        <TouchableOpacity
          key={value}
          style={[styles.segmentBtn, active && styles.segmentBtnActive]}
          onPress={() => setOrderHaptic(value)}
          activeOpacity={0.8}
          accessibilityRole="radio"
          accessibilityState={{ selected: active }}
          accessibilityLabel={label}
        >
          <Text
            style={[styles.segmentText, active && styles.segmentTextActive]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
</View>
  );
}
