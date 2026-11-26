import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import FestivalList from '../FestivalList';
import ScreenHeader from '../ScreenHeader';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';
import type { Festival } from '@festie/shared/types';

interface SchedulePickerViewProps {
  currentFestival: Festival | null;
  offlineMode: boolean;
  pickingFestival: boolean;
  setPickingFestival: Dispatch<SetStateAction<boolean>>;
}

export default function SchedulePickerView({
  currentFestival,
  offlineMode,
  pickingFestival,
  setPickingFestival,
}: SchedulePickerViewProps) {
  const styles = useStyles();
  const t = useTokens();
  // With no festivals loaded the list shows its own offline error, so the note would repeat it.
  const hasFestivals = useFestivalDataStore((s) => s.festivals.length > 0);
  return (
  // ScreenHeader owns the top safe-area inset (insets.top + spacing[4]) — the
  // native Tabs nav header is hidden (see (tabs)/_layout.tsx), so this is the
  // single top of the screen.
  <View style={styles.container}>
    <ScreenHeader
      title="Choose a festival"
      icon="musical-notes"
      right={
        pickingFestival && currentFestival ? (
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setPickingFestival(false)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Back to ${currentFestival.name}`}
          >
            <Ionicons name="close" size={t.iconSize.md} color={t.colors.text.secondary} />
          </TouchableOpacity>
        ) : undefined
      }
    />
    {pickingFestival && offlineMode && hasFestivals ? (
      <Text style={styles.pickerOffline} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        You&apos;re offline. Switching festivals needs signal. Your current lineup stays saved.
      </Text>
    ) : null}
    <FestivalList onSelected={() => setPickingFestival(false)} />
  </View>
  );
}
