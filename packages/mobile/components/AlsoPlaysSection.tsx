import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useFestivalDataStore, useUIStore } from '@festie/shared/stores';
import { useAlsoPlays, useCanPick, usePicks } from '@festie/shared/hooks';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { COPY } from '@festie/shared/constants';
import { artistDisplayName } from '@festie/shared/utils';
import type { FestivalSet } from '@festie/shared/types';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import AppPressable from './AppPressable';

/** Other upcoming slots of the same act. Renders nothing when there are none. */
export default function AlsoPlaysSection({ set, nowMs }: { set: FestivalSet; nowMs: number }) {
  const styles = useStyles();
  const router = useRouter();
  const haptics = useHaptics();
  const slots = useAlsoPlays(set, nowMs);
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const stages = useFestivalDataStore((s) => s.stages);
  const { getMyPick, savePick } = usePicks();
  const canPick = useCanPick();
  const [savingId, setSavingId] = useState<string | null>(null);
  const myPick = getMyPick(set.id);

  const pickToo = useCallback(
    (slotSetId: string) => {
      if (!festival || !myPick) return;
      haptics.select();
      setSavingId(slotSetId);
      savePick(festival.id, slotSetId, myPick)
        .catch((err) => {
          haptics.warning();
          useUIStore
            .getState()
            .showToast(mapErrorToUserMessage(err, "Couldn't save your pick. Try again."), { kind: 'error' });
        })
        .finally(() => setSavingId(null));
    },
    [festival, myPick, savePick, haptics],
  );

  if (slots.length === 0) return null;
  const artist = artistDisplayName(set, festival?.b2bSeparator);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {COPY.alsoPlays.heading}
      </Text>
      {slots.map((slot) => {
        const stage = stages.find((st) => st.id === slot.set.stageId)?.name;
        const slotPicked = !!getMyPick(slot.set.id);
        const canPickToo = canPick && !!myPick && !slotPicked;
        return (
          <View key={slot.set.id} style={styles.row}>
            <AppPressable
              style={styles.rowButton}
              onPress={() => router.push(`/set/${slot.set.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`${COPY.alsoPlays.row(slot.when)}${stage ? `, ${stage}` : ''}. Open this set.`}
            >
              <Text style={styles.when} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {COPY.alsoPlays.row(slot.when)}
              </Text>
              {stage ? (
                <Text style={styles.stage} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {stage}
                </Text>
              ) : null}
            </AppPressable>
            {canPickToo ? (
              <AppPressable
                style={[styles.chip, savingId === slot.set.id && styles.chipDisabled]}
                disabled={savingId !== null}
                onPress={() => pickToo(slot.set.id)}
                accessibilityRole="button"
                accessibilityLabel={COPY.alsoPlays.pickTooA11y(artist, slot.when)}
                accessibilityState={{ disabled: savingId !== null }}
              >
                <Text style={styles.chipText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {COPY.alsoPlays.pickToo}
                </Text>
              </AppPressable>
            ) : slotPicked ? (
              <Text style={styles.picked} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {COPY.alsoPlays.picked}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  section: { gap: t.spacing[2] },
  sectionLabel: { ...typeStyle('label'), color: t.colors.text.secondary },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  rowButton: { minHeight: 44, justifyContent: 'center', flexShrink: 1 },
  when: { ...typeStyle('body', 600), color: t.colors.text.primary },
  stage: { ...typeStyle('caption'), color: t.colors.text.muted },
  chip: {
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.overlay[3],
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  chipDisabled: { opacity: 0.5 },
  chipText: { ...typeStyle('label'), color: t.colors.accent.aqua },
  picked: { ...typeStyle('caption'), color: t.colors.text.muted },
}));
