import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type PicksGroupMode } from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useHaptics } from '../../hooks/useHaptics';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';

interface PicksControlsRowProps {
  groupMode: PicksGroupMode;
  myDayMode: boolean;
  search: string;
  searchOpen: boolean;
  setGroupModeHaptic: (mode: PicksGroupMode | "myday") => void;
  setSearch: (q: string) => void;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
}

export default function PicksControlsRow({
  groupMode,
  myDayMode,
  search,
  searchOpen,
  setGroupModeHaptic,
  setSearch,
  setSearchOpen,
}: PicksControlsRowProps) {
  const styles = useStyles();
  const t = useTokens();
  const haptics = useHaptics();
  return (
<View style={styles.controlsRow}>
  <View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Group picks by">
    {(['day', 'priority', 'myday'] as const).map((mode) => {
      const activeMode = mode === 'myday' ? myDayMode : !myDayMode && groupMode === mode;
      return (
        <TouchableOpacity
          key={mode}
          style={[styles.segmentBtn, activeMode && styles.segmentBtnActive]}
          onPress={() => setGroupModeHaptic(mode)}
          activeOpacity={0.8}
          accessibilityRole="radio"
          accessibilityState={{ selected: activeMode }}
          accessibilityLabel={
            mode === 'day' ? 'Group by day' : mode === 'priority' ? 'Group by priority' : 'Show my day'
          }
        >
          <Ionicons
            name={mode === 'day' ? 'calendar-clear-outline' : mode === 'priority' ? 'flag-outline' : 'time-outline'}
            size={t.iconSize.xs}
            color={activeMode ? t.colors.accent.aqua : t.colors.text.muted}
          />
          <Text
            style={[styles.segmentText, activeMode && styles.segmentTextActive]}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {mode === 'day' ? 'By day' : mode === 'priority' ? 'By priority' : COPY.myDay.name}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
  <TouchableOpacity
    style={[styles.iconControl, (searchOpen || search.length > 0) && styles.iconControlActive]}
    onPress={() => {
      haptics.tap();
      if (searchOpen) setSearch('');
      setSearchOpen((v) => !v);
    }}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityState={{ expanded: searchOpen }}
    accessibilityLabel={searchOpen ? 'Hide search' : 'Search my picks'}
  >
    <Ionicons
      name="search"
      size={t.iconSize.sm}
      color={searchOpen || search.length > 0 ? t.colors.accent.aqua : t.colors.text.muted}
    />
  </TouchableOpacity>
</View>
  );
}
