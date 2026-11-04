import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  PixelRatio,
  Platform,
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
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuthStore, useCrewStore, useFestivalDataStore, useFestivalStore, useUIStore } from '@festie/shared/stores';
import { COPY, PRIORITY_LABEL } from '@festie/shared/constants';
import { fetchPrintableSchedule, mapErrorToUserMessage } from '@festie/shared/services';
import {
  LOCKSCREEN_PRESETS,
  SCHEDULE_IMAGE_LAYOUT,
  buildLockscreenModel,
  buildScheduleImageModel,
  defaultScheduleImageDay,
  formatDayChip,
  type LockscreenMode,
  type ScheduleImageFormat,
} from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import SegmentedControl from '../components/SegmentedControl';
import ScheduleImagePoster from '../components/ScheduleImagePoster';
import LockscreenPoster from '../components/LockscreenPoster';
import AppSwitch from '../components/AppSwitch';

type Shape = 'lockscreen' | Exclude<ScheduleImageFormat, 'lockscreen'>;
type DayChoice = number | 'all';

const SHAPE_OPTIONS = [
  { value: 'lockscreen', label: 'Lock screen' },
  { value: 'story', label: 'Story' },
  { value: 'print', label: 'Print' },
] as const;

const MODE_OPTIONS = [
  { value: 'picks', label: 'My picks' },
  { value: 'full', label: 'Full lineup' },
  { value: 'stages', label: 'Stages' },
  { value: 'crew', label: 'Crew' },
] as const;

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Sunlight' },
] as const;

const LOOK_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'poster', label: 'Poster' },
] as const;

const PRIORITIES: Priority[] = ['must', 'want-to-see', 'maybe'];
const FALLBACK_SIZE = { width: 1290, height: 2796 };

const isMode = (v: unknown): v is LockscreenMode => MODE_OPTIONS.some((o) => o.value === v);

/** The real screen in device pixels; a non-phone shape falls back to a 9:19.5 phone. */
function detectScreenSize() {
  const { width, height } = Dimensions.get('screen');
  const ratio = PixelRatio.get();
  const w = Math.round(Math.min(width, height) * ratio);
  const h = Math.round(Math.max(width, height) * ratio);
  return w / h >= 9 / 21 && w / h <= 9 / 18 ? { width: w, height: h } : FALLBACK_SIZE;
}

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
 * Save your picks or the lineup as an image: a lock-screen wallpaper sized to this
 * phone (one or more images), a 9:16 story or an A4 print. Lock-screen layout comes
 * from the shared buildLockscreenModel; the poster is captured on the device (no
 * network) and handed to the share sheet one image at a time. Also offers the
 * server's printable HTML page.
 */
export default function PicksImageScreen() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const { width } = useWindowDimensions();
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();

  const festival = useFestivalDataStore((s) => s.currentFestival);
  const profile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const days = useFestivalDataStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewOverlap = useCrewStore((s) => s.crewOverlap);
  const selfUserId = useAuthStore((s) => s.user?.id);
  const picks = profile?.picks;

  const [shape, setShape] = useState<Shape>('lockscreen');
  const [mode, setMode] = useState<LockscreenMode>(isMode(modeParam) ? modeParam : 'picks');
  const [priorities, setPriorities] = useState<Priority[]>(PRIORITIES);
  const [stageIds, setStageIds] = useState<string[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [lockStyle, setLockStyle] = useState<'standard' | 'poster'>('standard');
  const [tallClock, setTallClock] = useState(false);
  const [onePage, setOnePage] = useState(false);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [choosingSize, setChoosingSize] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [saved, setSaved] = useState({ key: '', pages: 0 });
  const [capturePage, setCapturePage] = useState(0);
  const [chosenDay, setChosenDay] = useState<DayChoice | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const posterRef = useRef<HostInstance>(null);

  const format: Exclude<ScheduleImageFormat, 'lockscreen'> = shape === 'lockscreen' ? 'story' : shape;
  const lockMode: LockscreenMode = mode === 'crew' && !activeCrew ? 'picks' : mode;
  const picksDay = defaultScheduleImageDay({ sets, picks, selectedDay });
  const needsPicks = lockMode === 'picks' || lockMode === 'crew';
  const lockDay: DayChoice = chosenDay ?? (needsPicks ? (picksDay ?? selectedDay) : selectedDay);
  const storyDay = (chosenDay === 'all' ? null : chosenDay) ?? picksDay;

  const screenSize = useMemo(() => detectScreenSize(), []);
  const size = LOCKSCREEN_PRESETS.find((p) => p.id === presetId) ?? screenSize;

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

  const lockFor = useCallback(
    (day: DayChoice) =>
      buildLockscreenModel({
        festival: { name: festival?.name ?? 'Festie', b2bSeparator: festival?.b2bSeparator },
        sets,
        stages,
        days,
        picks,
        dayIndex: day,
        mode: lockMode,
        priorities,
        stageIds: stageIds.length ? stageIds : null,
        crewOverlap,
        selfUserId,
        theme,
        style: lockStyle,
        width: size.width,
        height: size.height,
        tallClock,
        onePage,
        savedAt: new Date(),
      }),
    [
      festival?.name,
      festival?.b2bSeparator,
      sets,
      stages,
      days,
      picks,
      lockMode,
      priorities,
      stageIds,
      crewOverlap,
      selfUserId,
      theme,
      lockStyle,
      size.width,
      size.height,
      tallClock,
      onePage,
    ],
  );

  const lockModel = useMemo(() => (shape === 'lockscreen' ? lockFor(lockDay) : null), [shape, lockFor, lockDay]);

  const dayChips = useMemo(
    () =>
      days.map((day, i) => ({
        index: i,
        label: formatDayChip(day).label,
        enabled:
          shape === 'lockscreen'
            ? !lockFor(i).empty
            : defaultScheduleImageDay({ sets, picks, selectedDay: i }) === i,
      })),
    [days, shape, lockFor, sets, picks],
  );

  const model = useMemo(
    () => (shape === 'lockscreen' || storyDay == null ? null : modelFor(storyDay, format)),
    [shape, storyDay, format, modelFor],
  );

  const pageCount = lockModel?.pages.length ?? 1;
  // A changed picture restarts the one-at-a-time save from image 1.
  const saveKey = JSON.stringify([lockMode, lockDay, priorities, stageIds, theme, lockStyle, size, tallClock, onePage]);
  const savedPages = saved.key === saveKey ? saved.pages : 0;
  const layout = shape === 'lockscreen' ? size : SCHEDULE_IMAGE_LAYOUT[format];
  const previewW = Math.min(260, width - 32);
  const scale = previewW / layout.width;
  const ready = shape === 'lockscreen' ? lockModel != null && !lockModel.empty : model != null;
  const dayValue: DayChoice | null = shape === 'lockscreen' ? lockDay : storyDay;

  const showError = useCallback(
    (message: string) => {
      haptics.warning();
      useUIStore.getState().showToast(message, { kind: 'error' });
    },
    [haptics],
  );

  const handleSave = useCallback(async () => {
    if (!ready || saving) return;
    setSaving(true);
    const page = shape === 'lockscreen' ? Math.min(savedPages, pageCount - 1) : 0;
    setCapturePage(page);
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
      if (shape === 'lockscreen') setSaved({ key: saveKey, pages: page + 1 >= pageCount ? 0 : page + 1 });
    } catch (err) {
      console.warn('picks image: capture failed', err);
      showError("Couldn't make the image. Try again.");
    } finally {
      setSaving(false);
    }
  }, [ready, saving, shape, savedPages, saveKey, pageCount, layout.width, layout.height, showError]);

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

  const togglePriority = (p: Priority) =>
    setPriorities((cur) => (cur.includes(p) ? (cur.length > 1 ? cur.filter((x) => x !== p) : cur) : [...cur, p]));
  const toggleStage = (id: string) =>
    setStageIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const chip = (key: string, label: string, active: boolean, onPress: () => void, enabled = true) => (
    <TouchableOpacity
      key={key}
      style={[styles.chip, active && styles.chipActive, !enabled && styles.chipDisabled]}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      disabled={!enabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled: !enabled }}
    >
      <Text
        style={[styles.chipText, active && styles.chipTextActive]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  const heading = (text: string) => (
    <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      {text}
    </Text>
  );

  const switchRow = (text: string, value: boolean, onChange: (v: boolean) => void) => (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text}
      </Text>
      <AppSwitch value={value} onValueChange={onChange} accessibilityLabel={text} accessibilityState={{ checked: value }} />
    </View>
  );

  const modeOptions = MODE_OPTIONS.filter((o) => o.value !== 'crew' || activeCrew);
  const lockscreen = shape === 'lockscreen';
  const grid = lockModel?.pages[0]?.body.kind === 'grid';
  const saveLabel =
    lockscreen && pageCount > 1 ? `Save image ${savedPages + 1} of ${pageCount}` : 'Save image';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: COPY.picks.saveImage, headerShown: true }} />
      <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Save your schedule as an image
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {lockscreen
          ? 'Pick what to show, then save each image and set it as your lock screen.'
          : "One day per image. If your picks don't all fit, Must See picks come first."}
      </Text>

      {heading('Shape')}
      <SegmentedControl options={SHAPE_OPTIONS} value={shape} onChange={setShape} accessibilityLabel="Shape" />

      {lockscreen ? (
        <>
          {heading('Show')}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {modeOptions.map((o) => chip(o.value, o.label, lockMode === o.value, () => setMode(o.value)))}
          </ScrollView>
          {lockMode === 'picks' || lockMode === 'crew' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {PRIORITIES.map((p) => chip(p, PRIORITY_LABEL[p], priorities.includes(p), () => togglePriority(p)))}
            </ScrollView>
          ) : null}
          {lockMode === 'stages' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {chip('all-stages', 'All stages', stageIds.length === 0, () => setStageIds([]))}
              {stages.map((st) => chip(st.id, st.name, stageIds.includes(st.id), () => toggleStage(st.id)))}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {ready || lockscreen ? (
        <>
          {heading('Day')}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {dayChips.map((c) => chip(String(c.index), c.label, c.index === dayValue, () => setChosenDay(c.index), c.enabled))}
            {lockscreen ? chip('all', 'All days', dayValue === 'all', () => setChosenDay('all')) : null}
          </ScrollView>
        </>
      ) : null}

      {lockscreen ? (
        <>
          {heading('Style')}
          <SegmentedControl options={THEME_OPTIONS} value={theme} onChange={setTheme} accessibilityLabel="Style" />
          <SegmentedControl options={LOOK_OPTIONS} value={lockStyle} onChange={setLockStyle} accessibilityLabel="Look" />
          {Platform.OS === 'ios' ? switchRow('Big iOS clock', tallClock, setTallClock) : null}
          {grid ? switchRow('Fit on one image', onePage, setOnePage) : null}

          {heading('Phone size')}
          <View style={styles.sizeRow}>
            <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {presetId
                ? `${LOCKSCREEN_PRESETS.find((p) => p.id === presetId)?.label} (${size.width} × ${size.height})`
                : `This phone (${size.width} × ${size.height})`}
            </Text>
            <TouchableOpacity
              onPress={() => setChoosingSize((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Change phone size"
              hitSlop={8}
            >
              <Text style={styles.link} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Change
              </Text>
            </TouchableOpacity>
          </View>
          {choosingSize ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {chip('auto', 'This phone', presetId == null, () => setPresetId(null))}
              {LOCKSCREEN_PRESETS.map((p) => chip(p.id, p.label, presetId === p.id, () => setPresetId(p.id)))}
            </ScrollView>
          ) : null}
        </>
      ) : null}

      {ready ? (
        <>
          {lockscreen && lockModel ? (
            <>
              <ScrollView
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                style={{ width: previewW + 2, alignSelf: 'center' }}
                onMomentumScrollEnd={(e) =>
                  setPreviewPage(Math.round(e.nativeEvent.contentOffset.x / (previewW + 2)))
                }
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {lockModel.pages.map((_, i) => (
                  <View key={i} style={[styles.preview, { width: previewW, height: layout.height * scale }]}>
                    <View style={{ transform: [{ scale }], transformOrigin: 'top left' }}>
                      <LockscreenPoster model={lockModel} page={i} />
                    </View>
                  </View>
                ))}
              </ScrollView>
              <Text style={styles.hintCenter} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                {`Image ${Math.min(previewPage, pageCount - 1) + 1} of ${pageCount}`}
              </Text>
            </>
          ) : model ? (
            <View
              style={[styles.preview, { width: previewW, height: layout.height * scale }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <View style={{ transform: [{ scale }], transformOrigin: 'top left' }}>
                <ScheduleImagePoster model={model} format={format} />
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryButton, saving && styles.disabled]}
            onPress={() => void handleSave()}
            disabled={saving}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            accessibilityLabel={saveLabel}
          >
            {saving ? <ActivityIndicator size="small" color={t.colors.text.onAccent} /> : null}
            <Text style={styles.primaryButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
              {saving ? 'Making image…' : saveLabel}
            </Text>
          </TouchableOpacity>
          <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {lockscreen && pageCount > 1
              ? 'In the share menu, choose Save Image. Then save the next image.'
              : 'In the share menu, choose Save Image to keep it in Photos.'}
          </Text>
          {lockscreen ? (
            <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {Platform.OS === 'ios'
                ? 'Open Photos, tap Share, then Use as Wallpaper. If notifications cover your schedule: Settings › Notifications › Display As › Count.'
                : 'Open Photos, tap ⋮ › Use as › Lock screen. Set lock-screen notifications to icons only so they do not cover the schedule.'}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {lockscreen
            ? 'Nothing matches these choices for this day, so there is nothing to draw.'
            : 'None of your picks have a set time yet, so there is nothing to draw.'}
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

      {saving && ready ? (
        <View style={styles.offscreen} pointerEvents="none">
          <View ref={posterRef} collapsable={false}>
            {lockscreen && lockModel ? (
              <LockscreenPoster model={lockModel} page={capturePage} pointScale={1 / PixelRatio.get()} />
            ) : model ? (
              <ScheduleImagePoster model={model} format={format} />
            ) : null}
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
  hintCenter: { ...typeStyle('caption'), color: t.colors.text.secondary, textAlign: 'center' },
  link: { ...typeStyle('label'), color: t.colors.accent.aqua },
  sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing[2] },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchLabel: { ...typeStyle('body'), color: t.colors.text.primary },
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
