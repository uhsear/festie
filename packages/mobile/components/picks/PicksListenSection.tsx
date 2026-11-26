import {
  View,
  Text,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import type { Dispatch, SetStateAction } from 'react';
import { useStyles } from './styles';
import type { ListenDay } from '@festie/shared/utils';

interface PicksListenSectionProps {
  handleShareListenList: () => void;
  listenList: ListenDay[];
  listenOpen: boolean;
  setListenOpen: Dispatch<SetStateAction<boolean>>;
}

export default function PicksListenSection({
  handleShareListenList,
  listenList,
  listenOpen,
  setListenOpen,
}: PicksListenSectionProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
<View style={styles.listenCard}>
  <TouchableOpacity
    style={styles.listenToggle}
    onPress={() => setListenOpen((o) => !o)}
    activeOpacity={0.8}
    accessibilityRole="button"
    accessibilityState={{ expanded: listenOpen }}
  >
    <Ionicons name="musical-notes-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
    <Text style={styles.listenTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      Listen before you go
    </Text>
    <Ionicons name={listenOpen ? 'chevron-up' : 'chevron-down'} size={t.iconSize.sm} color={t.colors.text.secondary} />
  </TouchableOpacity>
  {listenOpen && (
    <View>
      {listenList.map((day) => (
        <View key={day.label} style={styles.listenDay}>
          <Text style={styles.listenDayLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {day.label}
          </Text>
          {day.rows.map((row) => (
            <View key={row.setId} style={styles.listenRow}>
              <Text style={styles.listenName} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {row.name}
              </Text>
              {row.spotifyUrl ? (
                <TouchableOpacity
                  style={styles.listenLinkHit}
                  onPress={() => Linking.openURL(row.spotifyUrl as string).catch(() => {})}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${row.name} in Spotify`}
                >
                  <Text style={styles.listenLink} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    Spotify ↗
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </View>
      ))}
      <TouchableOpacity
        style={styles.calendarButton}
        onPress={handleShareListenList}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <Ionicons name="share-outline" size={t.iconSize.sm} color={t.colors.accent.aqua} />
        <Text style={styles.calendarButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          Share as text
        </Text>
      </TouchableOpacity>
    </View>
  )}
</View>
  );
}
