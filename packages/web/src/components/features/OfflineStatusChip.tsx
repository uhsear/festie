import { useEffect, useState } from 'react';
import { Check, Download } from 'lucide-react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useFestivalStore } from '@festie/shared/stores/festivalStore';
import {
  OFFLINE_REMINDER_TEXT,
  festivalPhase,
  offlineReminderAt,
  offlineStatusLabel,
  resolveFestivalTimeZone,
} from '@festie/shared/utils';
import { useOfflineDownload } from '../../hooks/useOfflineDownload';
import { cn } from '../../lib/utils';

const PILL =
  'inline-flex items-center gap-1.5 px-3 rounded-full text-xs font-medium bg-text-secondary/10 text-text-secondary';

function Chip({ festivalId, className, remind }: { festivalId: string; className?: string; remind: boolean }) {
  const { summary, download, isDownloading } = useOfflineDownload(festivalId);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const days = useFestivalStore((s) => s.days);

  // 30s tick so "synced N ago" keeps advancing from the device clock.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (summary.hidden) return null;

  if (summary.overall === 'ready') {
    return (
      <div className={cn('flex items-center text-xs', className)}>
        <span role="status" className={cn(PILL, 'min-h-8')}>
          <Check className="w-3.5 h-3.5 text-accent-aqua" aria-hidden="true" />
          {offlineStatusLabel(summary)}
        </span>
      </div>
    );
  }

  const label =
    summary.overall === 'partial'
      ? 'Offline download incomplete · Retry'
      : isDownloading || summary.overall === 'syncing'
        ? 'Downloading for offline…'
        : 'Download for offline';
  const busy = isDownloading || summary.overall === 'syncing';

  // The web side of the day-before reminder: from 18:00 festival time on the
  // eve of day 1 until the pack is ready or the festival is over.
  const remindAt =
    remind && currentFestival?.id === festivalId && festivalPhase(currentFestival, days) !== 'post'
      ? offlineReminderAt(days, { timeZone: resolveFestivalTimeZone(currentFestival), packReady: false })
      : null;
  const showReminder = remindAt !== null && Date.now() >= remindAt;

  return (
    <div className={cn('flex flex-wrap items-center gap-2 text-xs', className)}>
      {showReminder ? (
        <p className="basis-full rounded-xl border border-accent-amber/30 bg-accent-amber/10 px-3 py-2 text-sm text-accent-amber">
          {OFFLINE_REMINDER_TEXT}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        aria-busy={busy || undefined}
        className={cn(
          PILL,
          'min-h-11 hover:text-text-primary disabled:opacity-60 disabled:cursor-not-allowed',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
        )}
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}

/**
 * One-line offline status for a screen header. Renders nothing for guests or a hidden summary.
 * With `remind`, it also shows the day-before offline banner; pass it on the festival home only.
 */
export default function OfflineStatusChip({ className, remind = false }: { className?: string; remind?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const festivalId = useFestivalStore((s) => s.currentFestival?.id ?? null);
  if (!user || !festivalId) return null;
  return <Chip festivalId={festivalId} className={className} remind={remind} />;
}
