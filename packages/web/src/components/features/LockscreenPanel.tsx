import { useMemo, useRef, useState } from 'react';
import { useAuthStore, useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { useCrewOverlapStatus } from '@festie/shared/hooks';
import { PRIORITY_LABEL } from '@festie/shared/constants';
import { LOCKSCREEN_PRESETS, buildLockscreenModel } from '@festie/shared/utils';
import type { LockscreenMode, LockscreenStyle, LockscreenTheme } from '@festie/shared/utils';
import type { Priority } from '@festie/shared/types';
import Button from '../ui/Button';
import LockscreenPoster from './LockscreenPoster';
import { captureAndShareImages } from '../../lib/shareImage';
import { useToast } from '../../lib/toastContext';

const PREVIEW_WIDTH = 220;
const HAS_TIME = /^\d{1,2}:\d{2}$/;
const FALLBACK_SIZE = { width: 1290, height: 2796 };
const PRIORITIES: Priority[] = ['must', 'want-to-see', 'maybe'];
const MODES: Array<{ value: LockscreenMode; label: string }> = [
  { value: 'picks', label: 'My picks' },
  { value: 'full', label: 'Full lineup' },
  { value: 'stages', label: 'Stages' },
  { value: 'crew', label: 'Crew' },
];
const HINT_IOS =
  'Open Photos, tap Share, then Use as Wallpaper. If notifications cover your schedule: Settings › Notifications › Display As › Count.';
const HINT_ANDROID =
  "Open Photos, tap ⋮ › Use as › Lock screen. Set lock-screen notifications to icons only so they don't cover the schedule.";

const optionClass = (active: boolean) =>
  `rounded-full border px-3 min-h-9 text-xs font-semibold cursor-pointer transition-colors ${
    active ? 'border-accent-aqua text-accent-aqua bg-bg-card-hover' : 'border-border text-text-secondary'
  }`;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'festival';

/** The phone's own pixel size, or the generic 9:19.5 size when the screen is not a plausible portrait phone. */
export function deviceSize(): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(screen.width * dpr);
  const height = Math.round(screen.height * dpr);
  const ratio = height / width;
  return ratio >= 2 && ratio <= 21 / 9 ? { width, height } : FALLBACK_SIZE;
}

/** Lock-screen options: what to show, theme, phone size, a page preview, and saving every page. */
export default function LockscreenPanel({ initialMode }: { initialMode: LockscreenMode }) {
  const festival = useFestivalStore((s) => s.currentFestival);
  const profile = useFestivalStore((s) => s.currentProfile);
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);
  const days = useFestivalStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const hasCrew = useCrewStore((s) => s.activeCrew !== null);
  const crewOverlap = useCrewStore((s) => s.crewOverlap);
  const selfUserId = useAuthStore((s) => s.user?.id);
  const { toast, toastError } = useToast();
  const picks = profile?.picks;

  const [mode, setMode] = useState<LockscreenMode>(initialMode === 'crew' && !hasCrew ? 'picks' : initialMode);
  const [priorities, setPriorities] = useState<Priority[]>(PRIORITIES);
  const [stageIds, setStageIds] = useState<string[]>(() => stages.map((s) => s.id));
  const [dayChoice, setDayChoice] = useState<number | 'all' | null>(null);
  const [theme, setTheme] = useState<LockscreenTheme>('dark');
  const [lockStyle, setLockStyle] = useState<LockscreenStyle>('standard');
  const [tallClock, setTallClock] = useState(false);
  const [onePage, setOnePage] = useState(false);
  const [presetId, setPresetId] = useState('auto');
  const [pageIndex, setPageIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const captureRefs = useRef<Array<HTMLDivElement | null>>([]);

  const device = useMemo(deviceSize, []);
  const preset = LOCKSCREEN_PRESETS.find((p) => p.id === presetId);
  const size = preset ? { width: preset.width, height: preset.height } : device;
  const isPickMode = mode === 'picks' || mode === 'crew';
  const crewLoaded = useCrewOverlapStatus(mode === 'crew', festival?.id).status === 'ready';

  const dayHasSets = useMemo(() => {
    const out = new Set<number>();
    for (const s of sets) {
      if (!HAS_TIME.test(s.startTime ?? '')) continue;
      if (isPickMode && !picks?.[s.id]) continue;
      if (mode === 'stages' && !stageIds.includes(s.stageId)) continue;
      out.add(s.dayIndex ?? 0);
    }
    return out;
  }, [sets, picks, mode, isPickMode, stageIds]);
  const dayCount = Math.max(days.length, ...[...dayHasSets].map((d) => d + 1));
  const firstDay = [...dayHasSets].sort((a, b) => a - b)[0];
  const dayIndex: number | 'all' | null =
    dayChoice === 'all' && dayHasSets.size > 0
      ? 'all'
      : typeof dayChoice === 'number' && dayHasSets.has(dayChoice)
        ? dayChoice
        : dayHasSets.has(selectedDay)
          ? selectedDay
          : (firstDay ?? null);

  const model = useMemo(
    () =>
      festival && dayIndex !== null
        ? buildLockscreenModel({
            festival,
            sets,
            stages,
            days,
            picks,
            dayIndex,
            mode,
            priorities,
            stageIds: mode === 'stages' ? stageIds : null,
            crewOverlap: mode === 'crew' ? crewOverlap : undefined,
            crewLoaded,
            selfUserId,
            theme,
            style: lockStyle,
            width: size.width,
            height: size.height,
            tallClock,
            onePage,
            savedAt: new Date(),
          })
        : null,
    [festival, sets, stages, days, picks, dayIndex, mode, priorities, stageIds, crewOverlap, crewLoaded, selfUserId, theme, lockStyle, size.width, size.height, tallClock, onePage],
  );

  if (!festival) return null;
  const pages = model?.pages ?? [];
  const current = Math.min(pageIndex, Math.max(pages.length - 1, 0));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const flip = <T,>(list: T[], v: T, set: (l: T[]) => void) => {
    const next = toggle(list, v);
    if (next.length > 0) set(next);
  };
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const dayLabel = (i: number) => days[i]?.label ?? `Day ${i + 1}`;

  const save = async () => {
    if (!model || pages.length === 0) return;
    const nodes = captureRefs.current.slice(0, pages.length).filter((n): n is HTMLDivElement => n !== null);
    setBusy(true);
    try {
      const result = await captureAndShareImages(nodes, {
        width: model.width,
        height: model.height,
        filenames: pages.map((p, i) => `festie-${slug(festival.name)}-${slug(p.header.day)}-${mode}-${i + 1}of${pages.length}.png`),
        title: festival.name,
        backgroundColor: model.background.color,
      });
      if (result === 'downloaded') {
        toast(pages.length === 1 ? 'Image saved to your downloads.' : `${pages.length} images saved to your downloads.`, 'success');
      }
    } catch (err) {
      toastError(err, "Couldn't make the image. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const scale = model ? PREVIEW_WIDTH / model.width : 1;
  return (
    <div className="space-y-4">
      <span id="lockscreen-show" className="block text-sm text-text-secondary">
        Show
      </span>
      <div role="group" aria-labelledby="lockscreen-show" className="flex flex-wrap gap-2">
        {MODES.filter((m) => m.value !== 'crew' || hasCrew).map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            className={optionClass(mode === m.value)}
            onClick={() => {
              setMode(m.value);
              setPageIndex(0);
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {isPickMode && (
        <div role="group" aria-label="Priority" className="flex flex-wrap gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={priorities.includes(p)}
              className={optionClass(priorities.includes(p))}
              onClick={() => flip(priorities, p, setPriorities)}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      )}
      {mode === 'stages' && (
        <div role="group" aria-label="Stages" className="flex flex-wrap gap-2">
          {stages.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={stageIds.includes(s.id)}
              className={optionClass(stageIds.includes(s.id))}
              onClick={() => flip(stageIds, s.id, setStageIds)}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        Day
        <select
          value={dayIndex ?? ''}
          onChange={(e) => {
            setDayChoice(e.target.value === 'all' ? 'all' : Number(e.target.value));
            setPageIndex(0);
          }}
          className="min-h-9 rounded-lg border border-border bg-bg-card px-2 text-sm text-text-primary"
        >
          {Array.from({ length: dayCount }, (_, i) => (
            <option key={i} value={i} disabled={!dayHasSets.has(i)}>
              {dayLabel(i)}
            </option>
          ))}
          <option value="all" disabled={dayHasSets.size === 0}>
            All days
          </option>
        </select>
      </label>

      <div role="group" aria-label="Style" className="flex flex-wrap gap-2">
        {(['dark', 'light'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={theme === t} className={optionClass(theme === t)} onClick={() => setTheme(t)}>
            {t === 'dark' ? 'Dark' : 'Sunlight'}
          </button>
        ))}
      </div>
      <div role="group" aria-label="Look" className="flex flex-wrap gap-2">
        {(['standard', 'poster'] as const).map((l) => (
          <button key={l} type="button" aria-pressed={lockStyle === l} className={optionClass(lockStyle === l)} onClick={() => setLockStyle(l)}>
            {l === 'standard' ? 'Standard' : 'Poster'}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input type="checkbox" checked={tallClock} onChange={(e) => setTallClock(e.target.checked)} />
        Big iOS clock
      </label>
      {(mode === 'full' || mode === 'stages') && (
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input type="checkbox" checked={onePage} onChange={(e) => setOnePage(e.target.checked)} />
          Fit on one image
        </label>
      )}

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        Phone size
        <select
          value={presetId}
          onChange={(e) => setPresetId(e.target.value)}
          className="min-h-9 min-w-0 rounded-lg border border-border bg-bg-card px-2 text-sm text-text-primary"
        >
          <option value="auto">{`This phone (${device.width} × ${device.height})`}</option>
          {LOCKSCREEN_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{`${p.label} (${p.width} × ${p.height})`}</option>
          ))}
        </select>
      </label>

      {model && pages.length > 0 ? (
        <>
          <div
            aria-hidden="true"
            className="mx-auto overflow-hidden rounded-xl border border-border pointer-events-none"
            style={{ width: PREVIEW_WIDTH, height: model.height * scale }}
          >
            <div style={{ width: model.width, height: model.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <LockscreenPoster model={model} page={pages[current]!} />
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 text-xs text-text-secondary">
            <Button variant="secondary" size="sm" type="button" disabled={current === 0} onClick={() => setPageIndex(current - 1)}>
              Previous
            </Button>
            <span>{`Image ${current + 1} of ${pages.length}`}</span>
            <Button variant="secondary" size="sm" type="button" disabled={current >= pages.length - 1} onClick={() => setPageIndex(current + 1)}>
              Next
            </Button>
          </div>
          {/* Off-screen full-size copies: the capture nodes, one per page. */}
          <div aria-hidden="true" style={{ position: 'fixed', left: -100000, top: 0, pointerEvents: 'none' }}>
            {pages.map((p, i) => (
              <div key={i} ref={(el) => { captureRefs.current[i] = el; }}>
                <LockscreenPoster model={model} page={p} />
              </div>
            ))}
          </div>
          <Button variant="primary" size="sm" type="button" fullWidth onClick={save} disabled={busy}>
            {busy ? 'Making image…' : pages.length === 1 ? 'Save image' : `Save ${pages.length} images`}
          </Button>
        </>
      ) : (
        <p className="text-sm text-text-secondary">Nothing matches these options, so there is nothing to draw.</p>
      )}
      {isIos && <p className="text-xs text-text-muted">{HINT_IOS}</p>}
      {isAndroid && <p className="text-xs text-text-muted">{HINT_ANDROID}</p>}
      {!isIos && !isAndroid && (
        <>
          <p className="text-xs text-text-muted">{`iPhone: ${HINT_IOS}`}</p>
          <p className="text-xs text-text-muted">{`Android: ${HINT_ANDROID}`}</p>
        </>
      )}
    </div>
  );
}
