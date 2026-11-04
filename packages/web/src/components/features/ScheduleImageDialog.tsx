import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageDown, Smartphone } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { fetchPrintableSchedule } from '@festie/shared/services';
import { COPY } from '@festie/shared/constants';
import {
  SCHEDULE_IMAGE_LAYOUT,
  buildScheduleImageModel,
  defaultScheduleImageDay,
  scheduleImageFilename,
} from '@festie/shared/utils';
import type { LockscreenMode, ScheduleImageFormat } from '@festie/shared/utils';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import LockscreenPanel from './LockscreenPanel';
import ScheduleImagePoster from './ScheduleImagePoster';
import { captureAndShareImage } from '../../lib/shareImage';
import { useToast } from '../../lib/toastContext';

const PREVIEW_WIDTH = 240;
const FORMATS: Array<{ value: ScheduleImageFormat; label: string }> = [
  { value: 'story', label: 'Story' },
  { value: 'lockscreen', label: 'Lock screen' },
  { value: 'print', label: 'Print' },
];
const HAS_TIME = /^\d{1,2}:\d{2}$/;
// Print shape: print only the full-size poster copy, scaled to the A4 page width (210 mm = 794 CSS px = 0.64 x 1240).
const PRINT_CSS = `.festie-print-poster{display:none}
@media print{@page{size:A4 portrait;margin:0}
body>*:not(.festie-print-poster){display:none!important}
.festie-print-poster{display:block;width:210mm;height:297mm;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.festie-print-poster>div{transform:scale(0.64);transform-origin:top left}}`;

const optionClass = (active: boolean) =>
  `rounded-full border px-3 min-h-9 text-xs font-semibold cursor-pointer transition-colors ${
    active ? 'border-accent-aqua text-accent-aqua bg-bg-card-hover' : 'border-border text-text-secondary'
  }`;

/**
 * "Save image" chooser: story or lock-screen poster for one day, plus the printable HTML page.
 * With `initialMode` it is the schedule's "Lock screen image" entry: lock-screen options only.
 */
export default function ScheduleImageDialog({ initialMode }: { initialMode?: LockscreenMode } = {}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ScheduleImageFormat>('lockscreen');
  const [dayChoice, setDayChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);
  const { toast, toastError } = useToast();
  const festival = useFestivalStore((s) => s.currentFestival);
  const profile = useFestivalStore((s) => s.currentProfile);
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);
  const days = useFestivalStore((s) => s.days);
  const selectedDay = useFestivalStore((s) => s.selectedDay);
  const picks = profile?.picks;

  const timedDays = useMemo(
    () => new Set(sets.filter((s) => picks?.[s.id] && HAS_TIME.test(s.startTime ?? '')).map((s) => s.dayIndex ?? 0)),
    [sets, picks],
  );
  const defaultDay = defaultScheduleImageDay({ sets, picks, selectedDay });
  const dayIndex = dayChoice !== null && timedDays.has(dayChoice) ? dayChoice : defaultDay;

  const model = useMemo(
    () =>
      festival && dayIndex !== null
        ? buildScheduleImageModel({ festival, sets, stages, days, picks, dayIndex, format })
        : null,
    [festival, sets, stages, days, picks, dayIndex, format],
  );

  if (!festival || !profile) return null;
  if (initialMode) {
    return (
      <>
        <Button variant="secondary" size="sm" type="button" onClick={() => setOpen(true)}>
          <Smartphone className="w-4 h-4" aria-hidden="true" />
          Lock screen image
        </Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Lock screen image"
          description="Make a wallpaper of the schedule, sized for your phone."
        >
          <LockscreenPanel initialMode={initialMode} />
        </Dialog>
      </>
    );
  }
  const layout = SCHEDULE_IMAGE_LAYOUT[format];
  const scale = PREVIEW_WIDTH / layout.width;
  // Option labels reuse the model's day label so the picker matches the image.
  const dayLabels = days.map((_, i) =>
    buildScheduleImageModel({ festival, sets: [], stages, days, picks, dayIndex: i, format }).dayLabel,
  );
  const dayCount = Math.max(days.length, ...[...timedDays].map((d) => d + 1));

  const save = async () => {
    if (!posterRef.current || !model) return;
    setBusy(true);
    try {
      const result = await captureAndShareImage(posterRef.current, {
        width: layout.width,
        height: layout.height,
        filename: scheduleImageFilename(festival.name, model.dayLabel, format),
        title: `${festival.name} ${model.dayLabel}`,
      });
      if (result === 'downloaded') toast('Image saved to your downloads.', 'success');
    } catch (err) {
      toastError(err, "Couldn't make the image. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const downloadPrintable = async () => {
    setPrintBusy(true);
    try {
      const html = await fetchPrintableSchedule(festival.id, profile.id);
      const slug = festival.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'festival';
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `festie-${slug}-schedule.html` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Printable page saved to your downloads.', 'success');
    } catch (err) {
      toastError(err, "Couldn't download the printable page. Try again.");
    } finally {
      setPrintBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        aria-label="Save my picks as an image"
        onClick={() => setOpen(true)}
      >
        <ImageDown className="w-4 h-4" aria-hidden="true" />
        {COPY.picks.saveImage}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Save your picks as an image"
        description="One day per image. If your picks don't all fit, Must See picks come first."
      >
        {format === 'lockscreen' || (model && dayIndex !== null) ? (
          <div className="space-y-4">
            <span id="schedule-image-shape" className="block text-sm text-text-secondary">
              Shape
            </span>
            <div role="group" aria-labelledby="schedule-image-shape" className="flex gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={format === f.value}
                  className={optionClass(format === f.value)}
                  onClick={() => setFormat(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {format === 'lockscreen' ? (
              <LockscreenPanel initialMode="picks" />
            ) : model && dayIndex !== null ? (
              <>
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                Day
                <select
                  value={dayIndex}
                  onChange={(e) => setDayChoice(Number(e.target.value))}
                  className="min-h-9 rounded-lg border border-border bg-bg-card px-2 text-sm text-text-primary"
                >
                  {Array.from({ length: dayCount }, (_, i) => (
                    <option key={i} value={i} disabled={!timedDays.has(i)}>
                      {dayLabels[i] ?? `Day ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <div
                aria-hidden="true"
                className="mx-auto overflow-hidden rounded-xl border border-border pointer-events-none"
                style={{ width: PREVIEW_WIDTH, height: layout.height * scale }}
              >
                <div
                  style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
                >
                  <div ref={posterRef}>
                    <ScheduleImagePoster model={model} format={format} />
                  </div>
                </div>
              </div>
              {format === 'print' ? (
                <>
                  <Button variant="primary" size="sm" type="button" fullWidth onClick={() => window.print()}>
                    Print
                  </Button>
                  <style>{PRINT_CSS}</style>
                  {createPortal(
                    <div className="festie-print-poster" aria-hidden="true">
                      <ScheduleImagePoster model={model} format="print" />
                    </div>,
                    document.body,
                  )}
                </>
              ) : (
                <Button variant="primary" size="sm" type="button" fullWidth onClick={save} disabled={busy}>
                  {busy ? 'Making image…' : 'Save image'}
                </Button>
              )}
              </>
            ) : (
              <p className="text-sm text-text-secondary">
                None of your picks have a set time yet, so there is nothing to draw.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            None of your picks have a set time yet, so there is nothing to draw.
          </p>
        )}
        <div className="space-y-2">
          <Button variant="secondary" size="sm" type="button" fullWidth onClick={downloadPrintable} isLoading={printBusy}>
            {COPY.picks.printable}
          </Button>
          <p className="text-xs text-text-muted">
            A web page with your picks and your crew&apos;s schedules, ready to print.
          </p>
        </div>
      </Dialog>
    </>
  );
}
