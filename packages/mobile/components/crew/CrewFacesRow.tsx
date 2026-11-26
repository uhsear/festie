import { ScrollView, Text, View } from 'react-native';
import { useCrewFaces, useFestival } from '@festie/shared/hooks';
import { useFestivalStore } from '@festie/shared/stores';
import { resolveFestivalTimeZone } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';
import { useNow } from '../../hooks/useNow';
import { useLastKnownFix } from '../../hooks/useLastKnownFix';
import { safeStageColor } from '../../lib/stageColor';
import Avatar from '../Avatar';

/**
 * The crew hub's lead row: each crewmate's face, ringed in the colour of the
 * stage they stand at, with their walk time or when they were last seen.
 */
export default function CrewFacesRow() {
  const t = useTokens();
  const styles = useStyles();
  const days = useFestivalStore((s) => s.days);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const { getStageColor } = useFestival();
  const nowMs = useNow(60_000);
  const faces = useCrewFaces(nowMs, days, useLastKnownFix(), resolveFestivalTimeZone(currentFestival));
  if (faces.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
      testID="crew-faces"
      accessibilityLabel="Your crew right now"
    >
      {faces.map((f) => (
        <View key={f.userId} style={styles.face} accessible accessibilityLabel={`${f.name}, ${f.caption}`}>
          <Avatar
            name={f.name}
            size="md"
            borderColor={f.stageId ? safeStageColor(getStageColor(f.stageId), t.colors.border.default) : t.colors.border.default}
          />
          <Text style={styles.name} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {f.name}
          </Text>
          <Text
            style={[styles.caption, f.sos && styles.sos]}
            numberOfLines={2}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {f.caption}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  scroll: { flexGrow: 0, marginBottom: t.spacing[3] },
  row: { gap: t.spacing[4] },
  face: { width: 80, alignItems: 'center', gap: t.spacing[1] },
  name: { ...typeStyle('caption', 600), color: t.colors.text.primary, textAlign: 'center' },
  caption: { ...typeStyle('caption'), color: t.colors.text.secondary, textAlign: 'center' },
  sos: { color: t.colors.text.danger, fontWeight: '700' },
}));
