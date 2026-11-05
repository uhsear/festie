import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFestivalDataStore } from '@festie/shared/stores';
import { usePicks, useSetContext } from '@festie/shared/hooks';
import { COPY, PRIORITY_LABELS } from '@festie/shared/constants';
import { artistDisplayName } from '@festie/shared/utils';
import type { SetContextEntry } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import AppPressable from './AppPressable';

/** "On <stage> that night" neighbours and "Playing at the same time". Each part hides when empty. */
export default function SetContextSection({ set }: { set: FestivalSet }) {
  const styles = useStyles();
  const router = useRouter();
  const { before, after, overlaps } = useSetContext(set);
  const stages = useFestivalDataStore((s) => s.stages);
  const separator = useFestivalDataStore((s) => s.currentFestival?.b2bSeparator);
  const { getMyPick } = usePicks();

  const stageName = (s: FestivalSet) => stages.find((st) => st.id === s.stageId)?.name ?? s.stageName ?? '';

  const row = (e: SetContextEntry, lead?: string) => {
    const artist = artistDisplayName(e.set, separator);
    const stage = stageName(e.set);
    const pick = getMyPick(e.set.id);
    return (
      <AppPressable
        key={e.set.id}
        style={styles.row}
        onPress={() => router.push(`/set/${e.set.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`${COPY.setContext.openA11y(artist, stage, e.time)}${pick ? ` ${PRIORITY_LABELS[pick]}.` : ''}`}
      >
        <View style={styles.rowText}>
          <Text style={styles.artist} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {lead ? <Text style={styles.lead}>{`${lead}: `}</Text> : null}
            {artist}
          </Text>
          <Text style={styles.meta} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {lead ? e.time : `${stage} · ${e.time}`}
          </Text>
        </View>
        {pick ? (
          <Text style={styles.pick} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {PRIORITY_LABELS[pick]}
          </Text>
        ) : null}
      </AppPressable>
    );
  };

  return (
    <>
      {before || after ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {COPY.setContext.stageHeading(stageName(set))}
          </Text>
          {before ? row(before, COPY.setContext.before) : null}
          {after ? row(after, COPY.setContext.after) : null}
        </View>
      ) : null}
      {overlaps.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {COPY.setContext.overlapHeading}
          </Text>
          {overlaps.map((e) => row(e))}
        </View>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  section: { gap: t.spacing[2] },
  sectionLabel: { ...typeStyle('label'), color: t.colors.text.secondary },
  row: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: t.spacing[2] },
  rowText: { flex: 1 },
  artist: { ...typeStyle('body', 600), color: t.colors.text.primary },
  lead: { ...typeStyle('body'), color: t.colors.text.muted },
  meta: { ...typeStyle('caption'), color: t.colors.text.muted },
  pick: { ...typeStyle('caption'), color: t.colors.accent.aqua },
}));
