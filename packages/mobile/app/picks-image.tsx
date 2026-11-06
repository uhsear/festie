import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  PixelRatio,
  Platform,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
  type HostInstance,
  type ScrollViewInstance,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore, useCrewStore, useFestivalDataStore, useFestivalStore, useUIStore } from '@festie/shared/stores';
import { COPY, PRIORITY_LABEL } from '@festie/shared/constants';
import { fetchPrintableSchedule, mapErrorToUserMessage } from '@festie/shared/services';
import { useCrewOverlapStatus } from '@festie/shared/hooks';
import {
  LOCKSCREEN_PRESETS,
  SCHEDULE_IMAGE_LAYOUT,
  buildLockscreenModel,
  buildScheduleImageModel,
  defaultScheduleImageDay,
  formatDayChip,
  formatTime,
  lockscreenSavedKey,
  lockscreenSnapshot,
  setMinuteRange,
  type LockscreenCanvas,
  type LockscreenMode,
  type LockscreenModel,
  type ScheduleImageFormat,
} from '@festie/shared/utils';
import type { FestivalSet, Priority } from '@festie/shared/types';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import SegmentedControl from '../components/SegmentedControl';
import ScheduleImagePoster from '../components/ScheduleImagePoster';
import LockscreenPoster from '../components/LockscreenPoster';
import LockscreenOverlay, { type LockscreenClock } from '../components/LockscreenOverlay';
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
  { value: 'full', label: 'Full day' },
  { value: 'stages', label: 'Stages' },
  { value: 'crew', label: 'Crew' },
] as const;

const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Sunlight' },
] as const;

const LOOK_OPTIONS = [
  { value: 'standard', label: 'Plain' },
  { value: 'poster', label: 'Glow' },
] as const;

const CANVAS_OPTIONS = [
  { value: 'lockscreen', label: 'Lock screen' },
  { value: 'poster', label: 'Poster' },
] as const;

const CLOCK_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'big', label: 'Big clock' },
  { value: 'widgets', label: 'Clock + widgets' },
] as const;

const PRIORITIES: Priority[] = ['must', 'want-to-see', 'maybe'];
const FALLBACK_SIZE = { width: 1290, height: 2796 };
const HHMM = /^\d{1,2}:\d{2}$/;
const IOS = Platform.OS === 'ios';
const OPTIONS_KEY = 'festie.lockscreen.options.v1';
const STALE_SCHEDULE_MS = 30 * 60 * 1000;
const CAPTURE_ERROR = "Couldn't make the image. Try again. If it keeps failing, choose a smaller phone size.";

const HELP_STEPS = IOS
  ? [
      'Open Photos. Your image is the newest photo.',
      'Tap Share, then Use as Wallpaper.',
      'Turn off Perspective Zoom if it is offered. Do not pinch. Tap Add, then Set as Lock Screen.',
    ]
  : [
      'Open Photos or Gallery. Your image is the newest one.',
      'Tap ⋮, then look for Set as wallpaper or Use as. Choose Lock screen.',
    ];
const HELP_MULTI = IOS
  ? 'You can add a second lock screen. Long-press the lock screen and tap +.'
  : 'Set image 1 now. Set image 2 later in the day.';
const LIVE_TIP = IOS
  ? 'During the festival, Festie also keeps what is on now and next live on your lock screen.'
  : 'During the festival, a Festie notification also shows what is on now and next.';
const NOTIFICATION_TIP = IOS
  ? 'If notifications cover it: Settings › Notifications › Display As › Count.'
  : 'Set lock-screen notifications to icons only.';

const isMode = (v: unknown): v is LockscreenMode => MODE_OPTIONS.some((o) => o.value === v);
const isCanvas = (v: unknown): v is LockscreenCanvas => CANVAS_OPTIONS.some((o) => o.value === v);
const isClock = (v: unknown): v is LockscreenClock => CLOCK_OPTIONS.some((o) => o.value === v);

/** Look options restored from the last visit. Mode and phone size are never restored. */
interface SavedOptions {
  theme?: 'dark' | 'light';
  lockStyle?: 'standard' | 'poster';
  priorities?: Priority[];
  clock?: LockscreenClock;
  canvas?: LockscreenCanvas;
}

function parseSavedOptions(raw: string | null): SavedOptions {
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const list = Array.isArray(o.priorities) ? (o.priorities as unknown[]) : [];
    const priorities = PRIORITIES.filter((p) => list.includes(p));
    // tallClock is the first version's switch; it maps to the big clock.
    const clock = isClock(o.clock) ? o.clock : o.tallClock === true ? 'big' : o.tallClock === false ? 'normal' : undefined;
    return {
      theme: o.theme === 'dark' || o.theme === 'light' ? o.theme : undefined,
      lockStyle: o.lockStyle === 'standard' || o.lockStyle === 'poster' ? o.lockStyle : undefined,
      priorities: priorities.length ? priorities : undefined,
      clock,
      canvas: isCanvas(o.canvas) ? o.canvas : undefined,
    };
  } catch (err) {
    console.warn('picks image: ignoring bad saved options', err);
    return {};
  }
}

/** "1 PM – 9 PM": first start to the latest end of the sets on one image. */
function spanLabel(pageSets: FestivalSet[]): string {
  if (!pageSets.length) return '';
  const short = (t: string) => formatTime(t).replace(':00', '');
  const endOf = (s: FestivalSet) => setMinuteRange(s)?.end ?? 0;
  const last = pageSets.reduce((a, b) => (endOf(b) > endOf(a) ? b : a));
  return `${short(pageSets[0]!.startTime)} – ${short(last.endTime || last.startTime)}`;
}

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

const clockTime = (ms: number) => formatTime(new Date(ms).toTimeString().slice(0, 5));

const nextTwoFrames = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/**
 * Save your picks or the lineup as an image: a lock-screen wallpaper sized to this
 * phone (one or more images), a 9:16 story or an A4 print. Lock-screen layout comes
 * from the shared buildLockscreenModel; the poster is captured on the device (no
 * network) and handed to the share sheet one image at a time, starting from the
 * image on screen. A saved image is recorded so the Picks tab can say when it goes
 * out of date. Also offers the server's printable HTML page.
 */
export default function PicksImageScreen() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { width, height: windowH } = useWindowDimensions();
  const { mode: modeParam, day: dayParam } = useLocalSearchParams<{ mode?: string; day?: string }>();

  const festival = useFestivalDataStore((s) => s.currentFestival);
  const profile = useFestivalDataStore((s) => s.currentProfile);
  const sets = useFestivalDataStore((s) => s.sets);
  const stages = useFestivalDataStore((s) => s.stages);
  const days = useFestivalDataStore((s) => s.days);
  const fetchedAt = useFestivalDataStore((s) => s._festivalCachedAt);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewOverlap = useCrewStore((s) => s.crewOverlap);
  const selfUserId = useAuthStore((s) => s.user?.id);
  const picks = profile?.picks;

  const [shape, setShape] = useState<Shape>('lockscreen');
  const [mode, setMode] = useState<LockscreenMode>(isMode(modeParam) ? modeParam : 'picks');
  const [stageIds, setStageIds] = useState<string[]>([]);
  // Look options in one object; `touched` stops a late restore from overwriting the user's tap.
  const [look, setLook] = useState<{
    priorities: Priority[];
    theme: 'dark' | 'light';
    lockStyle: 'standard' | 'poster';
    clock: LockscreenClock;
    canvas: LockscreenCanvas;
    touched: boolean;
  }>({ priorities: PRIORITIES, theme: 'dark', lockStyle: 'standard', clock: 'normal', canvas: 'lockscreen', touched: false });
  const { priorities, theme, lockStyle, clock, canvas } = look;
  const [fromNow, setFromNow] = useState(false);
  const [onePage, setOnePage] = useState(true);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [fullSize, setFullSize] = useState(false);
  const [savedKey, setSavedKey] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [helpSeen, setHelpSeen] = useState(false);
  const [capture, setCapture] = useState<{ model: LockscreenModel; page: number } | null>(null);
  const [chosenDay, setChosenDay] = useState<DayChoice | null>(() => {
    const n = Number(dayParam);
    return dayParam != null && Number.isInteger(n) ? n : null;
  });
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [nowMs] = useState(() => Date.now());
  const [hydrated, setHydrated] = useState(false);
  const posterRef = useRef<HostInstance>(null);
  const pagerRef = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(OPTIONS_KEY)
      .then((raw) => {
        if (!live) return;
        const o = parseSavedOptions(raw);
        setLook((cur) =>
          cur.touched
            ? cur
            : {
                ...cur,
                theme: o.theme ?? cur.theme,
                lockStyle: o.lockStyle ?? cur.lockStyle,
                priorities: o.priorities ?? cur.priorities,
                clock: o.clock ?? cur.clock,
                canvas: o.canvas ?? cur.canvas,
              },
        );
      })
      .catch((err: unknown) => console.warn('picks image: could not read saved options', err))
      .finally(() => {
        if (live) setHydrated(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(OPTIONS_KEY, JSON.stringify({ theme, lockStyle, priorities, clock, canvas })).catch((err: unknown) =>
      console.warn('picks image: could not save options', err),
    );
  }, [hydrated, theme, lockStyle, priorities, clock, canvas]);

  const setPriorities = (priorities: Priority[]) => setLook((cur) => ({ ...cur, priorities, touched: true }));
  const setTheme = (theme: 'dark' | 'light') => setLook((cur) => ({ ...cur, theme, touched: true }));
  const setLockStyle = (lockStyle: 'standard' | 'poster') => setLook((cur) => ({ ...cur, lockStyle, touched: true }));
  const setClock = (clock: LockscreenClock) => setLook((cur) => ({ ...cur, clock, touched: true }));
  const setCanvas = (canvas: LockscreenCanvas) => setLook((cur) => ({ ...cur, canvas, touched: true }));

  const format: Exclude<ScheduleImageFormat, 'lockscreen'> = shape === 'lockscreen' ? 'story' : shape;
  const lockMode: LockscreenMode = mode === 'crew' && !activeCrew ? 'picks' : mode;
  const crew = useCrewOverlapStatus(shape === 'lockscreen' && lockMode === 'crew', festival?.id);
  const crewLoaded = crew.status === 'ready';
  const needsPicks = lockMode === 'picks' || lockMode === 'crew';
  const timeZone = festival?.timeZone;
  const picksDay = defaultScheduleImageDay({ sets, picks, selectedDay, days, nowMs, timeZone });

  const screenSize = useMemo(() => detectScreenSize(), []);
  const preset = LOCKSCREEN_PRESETS.find((p) => p.id === presetId);
  const size = preset ?? screenSize;
  const sizeEstimated = !preset && !LOCKSCREEN_PRESETS.some((p) => p.width === size.width && p.height === size.height);

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
    (day: DayChoice, only?: Priority[]) =>
      buildLockscreenModel({
        festival: { name: festival?.name ?? 'Festie', b2bSeparator: festival?.b2bSeparator },
        sets,
        stages,
        days,
        picks,
        dayIndex: day,
        mode: lockMode,
        priorities: only ?? priorities,
        stageIds: stageIds.length ? stageIds : null,
        crewOverlap,
        crewLoaded,
        selfUserId,
        theme,
        style: lockStyle,
        width: size.width,
        height: size.height,
        clock,
        canvas,
        fromMs: fromNow ? Date.now() : undefined,
        timeZone,
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
      crewLoaded,
      selfUserId,
      theme,
      lockStyle,
      size.width,
      size.height,
      clock,
      canvas,
      fromNow,
      timeZone,
      onePage,
    ],
  );

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

  // A day chosen in another mode can be empty here; fall back the way web does.
  const chosen = typeof chosenDay === 'number' && !dayChips[chosenDay]?.enabled ? null : chosenDay;
  const lockDay: DayChoice = chosen ?? (needsPicks ? (picksDay ?? selectedDay) : selectedDay);
  const storyDay = (chosen === 'all' ? null : chosen) ?? picksDay;

  const lockModel = useMemo(() => (shape === 'lockscreen' ? lockFor(lockDay) : null), [shape, lockFor, lockDay]);

  const model = useMemo(
    () => (shape === 'lockscreen' || storyDay == null ? null : modelFor(storyDay, format)),
    [shape, storyDay, format, modelFor],
  );

  const pageCount = lockModel?.pages.length ?? 1;
  const visiblePage = Math.min(previewPage, pageCount - 1);
  // A changed picture goes back to image 1.
  const saveKey = JSON.stringify([shape, lockMode, lockDay, priorities, stageIds, theme, lockStyle, size, clock, canvas, fromNow, onePage]);
  const layout = shape === 'lockscreen' ? size : SCHEDULE_IMAGE_LAYOUT[format];
  // The preview stays on screen while the options scroll under it; a short window keeps
  // at least 300pt of options visible.
  const previewH = Math.min(windowH * (windowH < 750 ? 0.4 : 0.46), windowH - insets.top - 300);
  const previewW = Math.min(width - 32, (previewH * layout.width) / layout.height);
  const scale = previewW / layout.width;
  const ready = shape === 'lockscreen' ? lockModel != null && !lockModel.empty : model != null;
  const dayValue: DayChoice | null = shape === 'lockscreen' ? lockDay : storyDay;
  const crewWaiting = shape === 'lockscreen' && lockMode === 'crew' && crew.status === 'loading';

  // One tap to fit a 2-image day on one image by leaving out Maybe picks.
  const withoutMaybe = useMemo(() => priorities.filter((p) => p !== 'maybe'), [priorities]);
  const maybeOnDay = sets.filter(
    (s) =>
      picks?.[s.id] === 'maybe' && HHMM.test(s.startTime ?? '') && (lockDay === 'all' || (s.dayIndex ?? 0) === lockDay),
  ).length;
  const fitsWithoutMaybe = useMemo(
    () =>
      shape === 'lockscreen' &&
      lockMode === 'picks' &&
      pageCount >= 2 &&
      priorities.includes('maybe') &&
      withoutMaybe.length > 0 &&
      maybeOnDay > 0 &&
      lockFor(lockDay, withoutMaybe).pages.length === 1,
    [shape, lockMode, pageCount, priorities, withoutMaybe, maybeOnDay, lockFor, lockDay],
  );

  const [pagedKey, setPagedKey] = useState(saveKey);
  if (pagedKey !== saveKey) {
    setPagedKey(saveKey);
    setPreviewPage(0);
  }
  useEffect(() => {
    pagerRef.current?.scrollTo({ x: 0, animated: false });
  }, [saveKey]);

  const showError = useCallback(
    (message: string) => {
      haptics.warning();
      useUIStore.getState().showToast(message, { kind: 'error' });
    },
    [haptics],
  );

  /** Remembers what the image showed per day, so the Picks tab can say when it goes out of date. */
  const recordSaved = useCallback(
    (saved: LockscreenModel) => {
      if (!festival) return;
      const byDay = new Map<number, string[]>();
      for (const p of saved.pages) byDay.set(p.dayIndex, [...(byDay.get(p.dayIndex) ?? []), ...p.setIds]);
      const savedAt = Date.now();
      const rows: [string, string][] = [...byDay].map(([dayIndex, setIds]) => [
        lockscreenSavedKey(festival.id, dayIndex),
        JSON.stringify(
          lockscreenSnapshot({ festivalId: festival.id, dayIndex, setIds, sets, b2bSeparator: festival.b2bSeparator, savedAt }),
        ),
      ]);
      AsyncStorage.multiSet(rows).catch((err: unknown) => console.warn('picks image: could not record the saved image', err));
    },
    [festival, sets],
  );

  const handleSave = useCallback(async () => {
    if (!ready || saving || crewWaiting) return;
    setSaving(true);
    const page = shape === 'lockscreen' ? visiblePage : 0;
    // Rebuilt at tap time so the footer's "Saved" time is when the image was made.
    const fresh = shape === 'lockscreen' ? lockFor(lockDay) : null;
    if (fresh) setCapture({ model: fresh, page: Math.min(page, fresh.pages.length - 1) });
    // The capture copy mounts only while saving. Wait two frames so React commits
    // and lays it out before captureRef looks up its native node.
    await nextTwoFrames();
    try {
      // iOS view-shot takes width/height in points and renders at the device scale,
      // so pixel sizes made a 3x canvas (8388 px tall) past the 8192 px limit.
      // Android takes pixels.
      const toUnits = IOS ? 1 / PixelRatio.get() : 1;
      const uri = await captureRef(posterRef, {
        format: 'png',
        quality: 1,
        width: layout.width * toUnits,
        height: layout.height * toUnits,
        result: 'tmpfile',
      });
      if (!(await Sharing.isAvailableAsync())) {
        showError(CAPTURE_ERROR);
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: shape === 'lockscreen' ? 'Save your lock-screen image' : 'Save your picks image',
      });
      // The sheet resolves the same way for save and cancel, so move on without claiming a save.
      if (fresh) {
        recordSaved(fresh);
        if (!helpSeen) {
          setShowHelp(true);
          setHelpSeen(true);
        }
        if (page + 1 < pageCount) {
          setPreviewPage(page + 1);
          pagerRef.current?.scrollTo({ x: (page + 1) * previewW, animated: true });
        } else {
          setSavedKey(saveKey);
        }
      }
    } catch (err) {
      console.warn('picks image: capture failed', err);
      showError(CAPTURE_ERROR);
    } finally {
      setSaving(false);
      setCapture(null);
    }
  }, [
    ready,
    saving,
    crewWaiting,
    shape,
    visiblePage,
    lockFor,
    lockDay,
    helpSeen,
    pageCount,
    previewW,
    saveKey,
    layout.width,
    layout.height,
    recordSaved,
    showError,
  ]);

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
    setPriorities(
      priorities.includes(p) ? (priorities.length > 1 ? priorities.filter((x) => x !== p) : priorities) : [...priorities, p],
    );
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

  const switchRow = (text: string, value: boolean, onChange: (v: boolean) => void, helper?: string) => (
    <View>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {text}
        </Text>
        <AppSwitch value={value} onValueChange={onChange} accessibilityLabel={text} accessibilityState={{ checked: value }} />
      </View>
      {helper ? (
        <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {helper}
        </Text>
      ) : null}
    </View>
  );

  const linkButton = (label: string, onPress: () => void) => (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}>
      <Text style={styles.link} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const modeOptions = MODE_OPTIONS.filter((o) => o.value !== 'crew' || activeCrew);
  const lockscreen = shape === 'lockscreen';
  const grid = lockModel?.pages[0]?.body.kind === 'grid';

  const setById = useMemo(() => new Map(sets.map((s) => [s.id, s])), [sets]);
  const pageSpan = (i: number) => {
    const ids = lockModel?.pages[i]?.setIds ?? [];
    return spanLabel(ids.map((id) => setById.get(id)).filter((s): s is FestivalSet => s != null));
  };
  // Timed picks on this day (any priority) next to the ones drawn, so a remembered filter stays visible.
  const timedPicks = needsPicks
    ? sets.filter((s) => picks?.[s.id] && HHMM.test(s.startTime ?? '') && (lockDay === 'all' || (s.dayIndex ?? 0) === lockDay))
        .length
    : 0;
  const shownPicks = lockModel?.pages.reduce((n, p) => n + p.setIds.length, 0) ?? 0;
  const statusLine = lockModel
    ? [
        pageCount > 1 ? `Image ${visiblePage + 1} of ${pageCount}` : '',
        pageSpan(visiblePage),
        needsPicks && shownPicks < timedPicks ? `Showing ${shownPicks} of ${timedPicks} picks` : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  const timesAsOf = fetchedAt != null && nowMs - fetchedAt > STALE_SCHEDULE_MS ? `Times as of ${clockTime(fetchedAt)}` : '';

  const verb = IOS ? 'Save' : 'Share';
  const savedAll = lockscreen && savedKey === saveKey && visiblePage === pageCount - 1;
  const saveLabel = !lockscreen
    ? IOS
      ? 'Save to Photos…'
      : 'Share image…'
    : savedAll
      ? `${verb} again…`
      : pageCount > 1
        ? `${verb} image ${visiblePage + 1} of ${pageCount}…`
        : IOS
          ? 'Save to Photos…'
          : 'Share image…';

  const noPicksAtAll = needsPicks && !Object.keys(picks ?? {}).length;
  const dayName = typeof lockDay === 'number' && days[lockDay] ? formatDayChip(days[lockDay]!).label : 'this day';
  const emptyText = !lockscreen
    ? 'None of your picks have a set time yet, so there is nothing to draw.'
    : noPicksAtAll
      ? 'You have no picks yet.'
      : needsPicks
        ? `No picks on ${dayName} with these filters.`
        : 'Nothing matches these choices for this day, so there is nothing to draw.';

  const previewBlock = ready ? (
    <View style={styles.previewBlock}>
      {lockscreen && lockModel ? (
        <>
          <ScrollView
            ref={pagerRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            style={{ width: previewW, alignSelf: 'center' }}
            onMomentumScrollEnd={(e) => setPreviewPage(Math.round(e.nativeEvent.contentOffset.x / previewW))}
          >
            {lockModel.pages.map((_, i) => (
              <TouchableOpacity
                key={i}
                activeOpacity={0.9}
                onPress={() => setFullSize(true)}
                accessibilityRole="button"
                accessibilityLabel={`Image ${i + 1} of ${pageCount}. Tap to see it full size.`}
                style={[styles.preview, { width: previewW, height: layout.height * scale }]}
              >
                <LockscreenPoster model={lockModel} page={i} pointScale={scale} />
                {canvas === 'lockscreen' ? <LockscreenOverlay width={previewW} height={layout.height * scale} clock={clock} /> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={styles.hintCenter} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {statusLine}
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
    </View>
  ) : null;

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        stickyHeaderIndices={previewBlock ? [1] : undefined}
      >
        <Stack.Screen options={{ title: COPY.picks.saveImage, headerShown: true }} />
        {previewBlock ?? <View />}

        {lockscreen && ready ? (
          <Text style={styles.hintCenter} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {'Preview only. The clock and buttons are not in your saved image. Tap it to see it full size.'}
          </Text>
        ) : null}

        {fitsWithoutMaybe ? (
          <View style={styles.chipCenter}>
            {chip('fit', `Fit on 1 image: hide ${maybeOnDay} Maybe ${maybeOnDay === 1 ? 'pick' : 'picks'}`, false, () =>
              setPriorities(withoutMaybe),
            )}
          </View>
        ) : null}

        {ready ? (
          <>
            <TouchableOpacity
              style={[styles.primaryButton, (saving || crewWaiting) && styles.disabled]}
              onPress={() => void handleSave()}
              disabled={saving || crewWaiting}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ disabled: saving || crewWaiting }}
              accessibilityLabel={saveLabel}
            >
              {saving || crewWaiting ? <ActivityIndicator size="small" color={t.colors.text.onAccent} /> : null}
              <Text style={styles.primaryButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
                {saving ? 'Making image…' : crewWaiting ? "Loading your crew's picks…" : saveLabel}
              </Text>
            </TouchableOpacity>
            <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {[IOS ? 'Next: tap Save Image.' : 'Next: pick Photos or Files to keep it.', timesAsOf].filter(Boolean).join(' ')}
            </Text>
            {lockscreen ? (
              showHelp ? (
                <View style={styles.card} accessibilityRole="summary">
                  <View style={styles.sizeRow}>
                    <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      Set it as your wallpaper
                    </Text>
                    {linkButton('Close', () => setShowHelp(false))}
                  </View>
                  {HELP_STEPS.map((step, i) => (
                    <Text key={step} style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {`${i + 1}. ${step}`}
                    </Text>
                  ))}
                  {pageCount > 1 ? (
                    <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {HELP_MULTI}
                    </Text>
                  ) : null}
                  <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {NOTIFICATION_TIP}
                  </Text>
                  <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    You only need to redo this if set times change. Festie tells you on the Picks tab.
                  </Text>
                  <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {LIVE_TIP}
                  </Text>
                </View>
              ) : (
                linkButton('How to set it as wallpaper', () => setShowHelp(true))
              )
            ) : null}
          </>
        ) : (
          <View style={styles.notice}>
            <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {emptyText}
            </Text>
            {lockscreen && needsPicks ? linkButton('Show full lineup', () => setMode('full')) : null}
          </View>
        )}

        {lockscreen ? (
          <>
            {heading('Show')}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {modeOptions.map((o) => chip(o.value, o.label, lockMode === o.value, () => setMode(o.value)))}
            </ScrollView>
            {needsPicks ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {PRIORITIES.map((p) => chip(p, PRIORITY_LABEL[p], priorities.includes(p), () => togglePriority(p)))}
              </ScrollView>
            ) : null}
            {lockMode === 'stages' || lockMode === 'full' ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {chip('all-stages', 'All stages', stageIds.length === 0, () => setStageIds([]))}
                {stages.map((st) =>
                  chip(st.id, st.name, stageIds.includes(st.id), () => {
                    toggleStage(st.id);
                    if (lockMode === 'full') setMode('stages');
                  }),
                )}
              </ScrollView>
            ) : null}
            {lockMode === 'crew' && crew.status === 'error' ? (
              <View style={styles.notice}>
                <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {"Couldn't load your crew's picks. Check your connection."}
                </Text>
                <View style={styles.sizeRow}>
                  {linkButton('Retry', crew.retry)}
                  {linkButton('Save without crew', () => setMode('picks'))}
                </View>
              </View>
            ) : null}
          </>
        ) : null}

        {ready || lockscreen ? (
          <>
            {heading('Day')}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {dayChips.map((c) =>
                chip(
                  String(c.index),
                  c.index === selectedDay ? `${c.label} · Today` : c.label,
                  c.index === dayValue,
                  () => setChosenDay(c.index),
                  c.enabled,
                ),
              )}
              {lockscreen ? chip('all', 'All days', dayValue === 'all', () => setChosenDay('all')) : null}
            </ScrollView>
            {lockscreen && needsPicks
              ? switchRow('Only sets still to come', fromNow, setFromNow, 'Leaves out sets that have already ended.')
              : null}
          </>
        ) : null}

        {lockscreen ? (
          <>
            {heading('Made for')}
            <SegmentedControl options={CANVAS_OPTIONS} value={canvas} onChange={setCanvas} accessibilityLabel="Image type" />
            {canvas === 'lockscreen' ? (
              <>
                {heading('Your lock screen')}
                <SegmentedControl options={CLOCK_OPTIONS} value={clock} onChange={setClock} accessibilityLabel="Clock" />
                <Text style={styles.hint} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  Pick Big clock or Clock + widgets if your clock is large or has widgets under it.
                </Text>
              </>
            ) : null}
            {heading('Look')}
            <SegmentedControl options={THEME_OPTIONS} value={theme} onChange={setTheme} accessibilityLabel="Colours" />
            {canvas === 'lockscreen' ? (
              <SegmentedControl options={LOOK_OPTIONS} value={lockStyle} onChange={setLockStyle} accessibilityLabel="Look" />
            ) : null}
          </>
        ) : null}

        <TouchableOpacity
          onPress={() => setMoreOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: moreOpen }}
          accessibilityLabel="More options"
          style={styles.moreRow}
        >
          <Text style={styles.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            More options
          </Text>
          <Text style={styles.link} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {moreOpen ? 'Hide' : 'Show'}
          </Text>
        </TouchableOpacity>

        {moreOpen ? (
          <>
            {lockscreen && grid ? switchRow('Split long days into 2 images (bigger text)', !onePage, (v) => setOnePage(!v)) : null}
            {lockscreen ? (
              <>
                {heading('Phone size')}
                <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {preset
                    ? `${preset.label} (${size.width} × ${size.height})`
                    : `This phone${sizeEstimated ? ' (estimated)' : ''} (${size.width} × ${size.height})`}
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                  {chip('auto', 'This phone', presetId == null, () => setPresetId(null))}
                  {LOCKSCREEN_PRESETS.map((p) => chip(p.id, p.label, presetId === p.id, () => setPresetId(p.id)))}
                </ScrollView>
              </>
            ) : null}
            {heading('Other formats')}
            <SegmentedControl options={SHAPE_OPTIONS} value={shape} onChange={setShape} accessibilityLabel="Format" />
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
          </>
        ) : null}

        {saving && ready ? (
          <View style={styles.offscreen} pointerEvents="none">
            <View ref={posterRef} collapsable={false}>
              {capture ? (
                <LockscreenPoster model={capture.model} page={capture.page} pointScale={1 / PixelRatio.get()} />
              ) : model ? (
                <ScheduleImagePoster model={model} format={format} />
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      {lockModel && fullSize ? (
        <Modal visible animationType="fade" onRequestClose={() => setFullSize(false)} supportedOrientations={['portrait']}>
          <View style={styles.fullRoot}>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              contentOffset={{ x: visiblePage * width, y: 0 }}
            >
              {lockModel.pages.map((_, i) => (
                <ScrollView key={i} style={{ width }} contentContainerStyle={{ paddingTop: insets.top }}>
                  <View style={{ width, height: (layout.height * width) / layout.width, overflow: 'hidden' }}>
                    <LockscreenPoster model={lockModel} page={i} pointScale={width / layout.width} />
                  </View>
                </ScrollView>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.closeButton, { top: insets.top + 8 }]}
              onPress={() => setFullSize(false)}
              accessibilityRole="button"
              accessibilityLabel="Close full-size preview"
            >
              <Text style={styles.closeText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg.primary },
  content: { padding: t.spacing[4], gap: t.spacing[3], paddingBottom: t.spacing[8] },
  body: { ...typeStyle('body'), color: t.colors.text.secondary },
  label: { ...typeStyle('label'), color: t.colors.text.primary },
  hint: { ...typeStyle('caption'), color: t.colors.text.secondary },
  hintCenter: { ...typeStyle('caption'), color: t.colors.text.secondary, textAlign: 'center' },
  link: { ...typeStyle('label'), color: t.colors.accent.aqua, minHeight: 44, textAlignVertical: 'center', paddingVertical: 10 },
  sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing[2] },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    marginTop: t.spacing[2],
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchLabel: { ...typeStyle('body'), color: t.colors.text.primary, flex: 1 },
  chipRow: { gap: t.spacing[2] },
  chipCenter: { alignItems: 'center' },
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
  notice: { gap: t.spacing[1] },
  card: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  previewBlock: { gap: t.spacing[1], paddingBottom: t.spacing[2], backgroundColor: t.colors.bg.primary },
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
  fullRoot: { flex: 1, backgroundColor: '#000' },
  closeButton: {
    position: 'absolute',
    right: t.spacing[4],
    minHeight: 44,
    paddingHorizontal: t.spacing[4],
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  closeText: { ...typeStyle('label'), color: '#fff' },
}));
