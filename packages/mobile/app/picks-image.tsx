import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  type HostInstance,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Stack } from 'expo-router';
import { useFestivalDataStore, useFestivalStore, useUIStore } from '@festie/shared/stores';
import { COPY } from '@festie/shared/constants';
import { fetchPrintableSchedule, mapErrorToUserMessage } from '@festie/shared/services';
import {
  SCHEDULE_IMAGE_LAYOUT,
  buildScheduleImageModel,
  defaultScheduleImageDay,
  type ScheduleImageFormat,
} from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import SegmentedControl from '../components/SegmentedControl';
import ScheduleImagePoster from '../components/ScheduleImagePoster';

const SHAPE_OPTIONS = [
  { value: 'story', label: 'Story' },
  { value: 'lockscreen', label: 'Lock screen' },
  { value: 'print', label: 'Print' },
] as const;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

const nextTwoFrames = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Save your picks as an image: one day per image, as a 9:16 story or a taller
 * lock-screen wallpaper. The layout comes from the shared buildScheduleImageModel;
 * the poster is captured on the device (no network) and handed to the share sheet.
 * Also offers the server's printable HTML page.
 */
export default function PicksImageScreen() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { width } = useWindowDimensions();

  const festival = useFestivalDataStore((s) => s.currentFestival);
  const profile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const days = useFestivalDataStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const picks = profile?.picks;

  const [format, setFormat] = useState<ScheduleImageFormat>('story');
  const [chosenDay, setChosenDay] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const posterRef = useRef<HostInstance>(null);

  const dayIndex = chosenDay ?? defaultScheduleImageDay({ sets, picks, selectedDay });

  const modelFor = useCallback(
    (day: number, fmt: ScheduleImageFormat) =>
      buildScheduleImageModel({
        festival: { name: festival?.name ?? 'Festie', b2bSeparator: festival?.b2bSeparator },
        sets,
        stages,
        days,
        picks,
        dayIndex: day,
        format: fmt,
      }),
    [festival?.name, festival?.b2bSeparator, sets, stages, days, picks],
  );

  const dayChips = useMemo(
    () =>
      days.map((_, i) => ({
        index: i,
        label: modelFor(i, 'story').dayLabel,
        enabled: defaultScheduleImageDay({ sets, picks, selectedDay: i }) === i,
      })),
    [days, modelFor, sets, picks],
  );

  const model = useMemo(() => (dayIndex == null ? null : modelFor(dayIndex, format)), [dayIndex, format, modelFor]);

  const layout = SCHEDULE_IMAGE_LAYOUT[format];
  const previewW = Math.min(260, width - 32);
  const scale = previewW / layout.width;

  const showError = useCallback(
    (message: string) => {
      haptics.warning();
      useUIStore.getState().showToast(message, { kind: 'error' });
    },
    [haptics],
  );

  const handleSave = useCallback(async () => {
    if (!model || saving) return;
    setSaving(true);
    // The capture copy mounts only while saving. Wait two frames so React commits
    // and lays it out before captureRef looks up its native node.
    await nextTwoFrames();
    try {
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        width: layout.width,
        height: layout.height,
        result: 'tmpfile',
      });
      if (!(await Sharing.isAvailableAsync())) {
        showError("Couldn't make the image. Try again.");
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: 'Save your picks image',
      });
    } catch {
      showError("Couldn't make the image. Try again.");
    } finally {
      setSaving(false);
    }
  }, [model, saving, layout.width, layout.height, showError]);

  const handlePrintable = useCallback(async () => {
    if (!festival || !profile || printing) return;
    setPrinting(true);
    try {
      const html = await fetchPrintableSchedule(festival.id, profile.id);
      const file = new File(Paths.cache, `festie-${slug(festival.name)}-schedule.html`);
      file.create({ overwrite: true });
      file.write(html);
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/html',
        UTI: 'public.html',
        dialogTitle: COPY.picks.printable,
      });
    } catch (err) {
      showError(mapErrorToUserMessage(err, "Couldn't download the printable page. Try again."));
    } finally {
      setPrinting(false);
    }
  }, [festival, profile, printing, showError]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: COPY.picks.saveImage, headerShown: true }} />
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Save your picks as an image
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        One day per image. If your picks don't all fit, Must See picks come first.
      </Text>

      {model && dayIndex != null ? (
        <>
          <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Shape
          </Text>
          <SegmentedControl
            options={SHAPE_OPTIONS}
            value={format}
            onChange={setFormat}
            accessibilityLabel="Shape"
          />
          {format === 'lockscreen' ? (
            <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Leaves room for the clock. Save the image, then set it as your wallpaper from your Photos app.
            </Text>
          ) : null}

          <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            Day
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {dayChips.map((chip) => {
              const active = chip.index === dayIndex;
              return (
                <TouchableOpacity
                  key={chip.index}
                  style={[styles.chip, active && styles.chipActive, !chip.enabled && styles.chipDisabled]}
                  onPress={() => {
                    haptics.select();
                    setChosenDay(chip.index);
                  }}
                  disabled={!chip.enabled}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={chip.label}
                  accessibilityState={{ selected: active, disabled: !chip.enabled }}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    numberOfLines={1}
                  >
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View
            style={[styles.preview, { width: previewW, height: layout.height * scale }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={{ transform: [{ scale }], transformOrigin: 'top left' }}>
              <ScheduleImagePoster model={model} format={format} />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.disabled]}
            onPress={() => void handleSave()}
            disabled={saving}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            accessibilityLabel="Save image"
          >
            {saving ? <ActivityIndicator size="small" color={t.colors.text.onAccent} /> : null}
            <Text style={styles.primaryButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
              {saving ? 'Making image…' : 'Save image'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            In the share menu, choose Save Image to keep it in Photos.
          </Text>
        </>
      ) : (
        <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          None of your picks have a set time yet, so there is nothing to draw.
        </Text>
      )}

      <TouchableOpacity
        style={[styles.secondaryButton, (printing || !festival || !profile) && styles.disabled]}
        onPress={() => void handlePrintable()}
        disabled={printing || !festival || !profile}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ disabled: printing || !festival || !profile }}
        accessibilityLabel={COPY.picks.printable}
      >
        {printing ? <ActivityIndicator size="small" color={t.colors.accent.aqua} /> : null}
        <Text style={styles.secondaryButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
          {COPY.picks.printable}
        </Text>
      </TouchableOpacity>
      <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        A web page with your picks and your crew's schedules, ready to print.
      </Text>

      {saving && model ? (
        <View style={styles.offscreen} pointerEvents="none">
          <View ref={posterRef} collapsable={false}>
            <ScheduleImagePoster model={model} format={format} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg.primary },
  content: { padding: t.spacing[4], gap: t.spacing[3], paddingBottom: t.spacing[8] },
  title: { ...typeStyle('title'), color: t.colors.text.primary },
  body: { ...typeStyle('body'), color: t.colors.text.secondary },
  label: { ...typeStyle('label'), color: t.colors.text.primary },
  hint: { ...typeStyle('caption'), color: t.colors.text.secondary },
  chipRow: { gap: t.spacing[2] },
  chip: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
  },
  chipActive: { borderColor: t.colors.accent.aqua, backgroundColor: t.colors.aquaAlpha[10] },
  chipDisabled: { opacity: 0.4 },
  chipText: { ...typeStyle('caption'), color: t.colors.text.secondary },
  chipTextActive: { ...typeStyle('caption', 700), color: t.colors.accent.aqua },
  preview: {
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  primaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.aqua,
  },
  primaryButtonText: { ...typeStyle('label'), color: t.colors.text.onAccent },
  secondaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  secondaryButtonText: { ...typeStyle('label'), color: t.colors.accent.aqua },
  disabled: { opacity: 0.5 },
  offscreen: { position: 'absolute', left: -99999, top: 0 },
}));
