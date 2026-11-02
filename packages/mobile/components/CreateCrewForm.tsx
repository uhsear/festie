import { useEffect, useMemo, useState } from 'react';
import { Alert, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useCreateCrew } from '@festie/shared/hooks';
import { useCrewStore, useFestivalStore } from '@festie/shared/stores';
import type { Crew } from '@festie/shared/types';
import { crewCapState, crewCopy, crewFestivalChoices, festivalLabel } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import Button from './Button';

interface CreateCrewFormProps {
  onCreated?: (crew: Crew) => void;
}

const MAX_CHOICES = 10;

/** Create-a-crew form. A crew belongs to one festival, so the festival is chosen here, not assumed. */
export default function CreateCrewForm({ onCreated }: CreateCrewFormProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const createCrew = useCreateCrew();

  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);
  const crews = useCrewStore((s) => s.crews);

  const [name, setName] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (festivals.length === 0) loadFestivals().catch(() => {});
  }, [festivals.length, loadFestivals]);

  const choices = useMemo(
    () => crewFestivalChoices(festivals, currentFestival?.id),
    [festivals, currentFestival?.id],
  );
  const chosen = choices.find((f) => f.id === pickedId) ?? choices.find((f) => f.id === currentFestival?.id) ?? choices[0];
  const cap = crewCapState(crews, chosen?.id);
  const trimmed = name.trim();
  const canSubmit = !!chosen && !cap.atCap && !!trimmed && !busy;

  const changeFestival = () =>
    Alert.alert('Choose a festival', undefined, [
      ...choices.slice(0, MAX_CHOICES).map((f) => ({ text: festivalLabel(f), onPress: () => setPickedId(f.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  const submit = async () => {
    if (!chosen || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const crew = await createCrew(trimmed, chosen.id);
      haptics.success();
      setName('');
      onCreated?.(crew);
    } catch {
      haptics.error();
      setError(useCrewStore.getState().error ?? "Couldn't create crew. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Create a crew
      </Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Sunset Squad"
        placeholderTextColor={t.colors.text.placeholder}
        maxLength={60}
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={submit}
        accessibilityLabel="Crew name"
      />
      {chosen ? (
        <View style={styles.festivalRow}>
          <Text style={styles.festivalText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {crewCopy.createFor(festivalLabel(chosen))}
          </Text>
          {choices.length >= 2 ? (
            <TouchableOpacity
              onPress={changeFestival}
              style={styles.changeButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Change festival"
            >
              <Text style={styles.changeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Change
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <Text style={styles.festivalText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {crewCopy.pickFestivalFirst}
        </Text>
      )}
      {cap.text ? (
        <Text style={cap.atCap ? styles.warn : styles.helper} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {cap.text}
        </Text>
      ) : null}
      <Text style={styles.helper} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {crewCopy.createHelper}
      </Text>
      {error ? (
        <Text style={styles.warn} accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {error}
        </Text>
      ) : null}
      <Button
        label={busy ? 'Creating…' : 'Create crew'}
        accessibilityLabel="Create crew"
        onPress={submit}
        disabled={!canSubmit}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    gap: t.spacing[2],
  },
  label: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  festivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  festivalText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  changeButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[2],
  },
  changeText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  helper: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  warn: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
}));
