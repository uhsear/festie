import { Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useAlsoPicked } from '@festie/shared/hooks';
import { DISCOVER_COPY } from '@festie/shared/constants';
import { artistDisplayName, formatTime } from '@festie/shared/utils';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

/** "People who picked this also picked". Renders nothing until the API returns sets. */
export default function AlsoPickedSection({ setId }: { setId: string }) {
  const styles = useStyles();
  const router = useRouter();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const stages = useFestivalDataStore((s) => s.stages);
  const days = useFestivalDataStore((s) => s.days);
  const { sets, status } = useAlsoPicked(festival?.id, setId);

  if (status !== 'ready' || sets.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.label} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {DISCOVER_COPY.alsoPicked.heading}
      </Text>
      {sets.map((set) => {
        const day = typeof set.dayIndex === 'number' ? days[set.dayIndex] : undefined;
        const detail = [
          day?.label ?? day?.date,
          set.startTime ? formatTime(set.startTime) : undefined,
          stages.find((st) => st.id === set.stageId)?.name,
        ]
          .filter(Boolean)
          .join(' · ');
        const name = artistDisplayName(set, festival?.b2bSeparator);
        return (
          <TouchableOpacity
            key={set.id}
            style={styles.row}
            onPress={() => router.push(`/set/${set.id}`)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={detail ? `${name}, ${detail}` : name}
          >
            <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {name}
            </Text>
            {detail ? (
              <Text style={styles.detail} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {detail}
              </Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: { gap: t.spacing[2], marginTop: t.spacing[1] },
  label: { ...typeStyle('label'), color: t.colors.text.secondary },
  row: { minHeight: 44, justifyContent: 'center' },
  name: { ...typeStyle('body'), color: t.colors.text.primary },
  detail: { ...typeStyle('caption'), color: t.colors.text.muted },
}));
