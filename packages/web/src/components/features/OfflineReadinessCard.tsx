import { useEffect, useRef, useState } from 'react';
import { Check, AlertCircle, ChevronDown, Download, RefreshCw } from 'lucide-react';
import type { SectionReadiness } from '@festie/shared/stores/offlineReadinessStore';
import { offlineActionLabel, offlineStatusLabel, timeAgo } from '@festie/shared/utils';
import { useOfflineDownload } from '../../hooks/useOfflineDownload';
import { cn } from '../../lib/utils';

interface Props {
  festivalId: string;
  className?: string;
}

// R18: per-step state renderer.
// pending  -> 8px muted dot
// active   -> 8px aqua pulsing dot + shimmer placeholder label
// done     -> aqua check icon + "synced N ago"
// error    -> coral alert icon + label text + inline retry button
function StepRow({
  label,
  section,
  tick,
  detail,
  onRetry,
}: {
  label: string;
  section: SectionReadiness;
  tick: number;
  detail?: string;
  onRetry?: () => void;
}) {
  // tick forces re-render so "synced N ago" advances from the device clock.
  void tick;

  const isPending = section.status === 'idle';
  const isActive = section.status === 'syncing';
  const isDone = section.status === 'ready';
  const isError = section.status === 'error';

  return (
    <li className="flex flex-wrap items-center gap-x-3 py-2" aria-live="polite" aria-atomic="true">
      {/* Step indicator: pending dot / active pulse / done check / error icon */}
      <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">
        {isDone ? (
          <Check className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
        ) : isError ? (
          <AlertCircle className="w-4 h-4 text-accent-coral" aria-hidden="true" />
        ) : isActive ? (
          <span
            className="block w-2 h-2 rounded-full motion-reduce:opacity-60"
            style={{ background: 'var(--color-accent-aqua)', animation: 'offline-step-pulse 900ms ease-in-out infinite' }}
            aria-hidden="true"
          />
        ) : (
          <span className="block w-2 h-2 rounded-full" style={{ background: 'var(--color-border-light)' }} aria-hidden="true" />
        )}
      </span>

      {/* Step label */}
      <span
        className={cn(
          'text-sm font-medium flex-1',
          isDone && 'text-text-primary',
          isActive && 'text-text-secondary',
          isPending && 'text-text-muted',
          isError && 'text-accent-coral',
        )}
      >
        {label}
      </span>

      {/* Right-side: status text or retry */}
      <span className="ml-auto flex items-center gap-1.5 text-xs tabular-nums">
        {isPending && <span className="text-text-muted">Not saved</span>}
        {isDone && (
          <span className="text-accent-aqua">
            {section.syncedAt != null ? `synced ${timeAgo(section.syncedAt)}` : 'ready'}
          </span>
        )}
        {isActive && (
          /* Shimmer placeholder while downloading */
          <span
            className="skeleton-shimmer inline-block"
            aria-label="Downloading"
            style={{ width: 80, height: 10, borderRadius: 4 }}
          />
        )}
        {isError && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1 text-accent-coral hover:text-text-primary transition-colors focus-visible:outline-1 focus-visible:outline-accent-coral rounded"
            aria-label={`Retry ${label}`}
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" />
            Retry
          </button>
        )}
        {isError && !onRetry && (
          <span className="text-accent-coral">
            {section.syncedAt != null ? `failed · ${timeAgo(section.syncedAt)}` : 'failed'}
          </span>
        )}
      </span>
      {detail && <p className="basis-full pl-8 pt-1 text-xs text-accent-coral">{detail}</p>}
    </li>
  );
}

/**
 * Offline download card. One header row (status, action, chevron) with the
 * per-step checklist collapsed by default. State comes from useOfflineDownload,
 * which adds the web-only map archive to the five store sections.
 *
 * The "synced N ago" labels advance from the device clock via a 30s tick,
 * the same offline-honesty pattern as FreshnessChip.
 */
export default function OfflineReadinessCard({ festivalId, className }: Props) {
  const { steps, summary, download, isDownloading, mapBytes, hasMap } = useOfflineDownload(festivalId);
  const [expanded, setExpanded] = useState(false);

  // 30s tick so "synced N ago" keeps advancing from the device clock.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Inject the pulse keyframe once. Co-located with the only consumer.
  // prefers-reduced-motion variant collapses the animation.
  const keyframeInjected = useRef(false);
  useEffect(() => {
    if (keyframeInjected.current) return;
    keyframeInjected.current = true;
    const style = document.createElement('style');
    style.dataset.offlineStep = '1';
    style.textContent =
      '@keyframes offline-step-pulse{' +
      '0%,100%{opacity:1;transform:scale(1)}' +
      '50%{opacity:0.45;transform:scale(1.35)}' +
      '}' +
      '@media(prefers-reduced-motion:reduce){' +
      '@keyframes offline-step-pulse{from,to{opacity:0.7;transform:none}}' +
      '}';
    document.head.appendChild(style);
  }, []);

  if (summary.hidden) return null;

  const handleDownload = () => void download();
  const mapMb = mapBytes != null ? ` The map is ${Math.max(1, Math.round(mapBytes / 1_000_000))} MB.` : '';
  const description = hasMap
    ? `Saves the schedule, your picks, crew plan, weather, artist art and the festival map so they work with no signal.${mapMb}`
    : 'Saves the schedule, your picks, crew plan, weather and artist art so they work with no signal. The map needs signal at this festival.';

  return (
    <section
      className={cn('rounded-xl border border-border bg-bg-card px-4', className)}
      aria-label="Download festival for offline"
    >
      <div className="flex items-center gap-2 min-h-11 py-1">
        <span className="flex-shrink-0 flex items-center justify-center w-5 h-5">
          {summary.overall === 'ready' ? (
            <Check className="w-4 h-4 text-accent-aqua" aria-hidden="true" />
          ) : summary.overall === 'partial' ? (
            <AlertCircle className="w-4 h-4 text-accent-coral" aria-hidden="true" />
          ) : summary.overall === 'syncing' ? (
            <span
              className="block w-2 h-2 rounded-full motion-reduce:opacity-60"
              style={{ background: 'var(--color-accent-aqua)', animation: 'offline-step-pulse 900ms ease-in-out infinite' }}
              aria-hidden="true"
            />
          ) : (
            <Download className="w-4 h-4 text-text-secondary" aria-hidden="true" />
          )}
        </span>
        <span className="flex-1 min-w-0 truncate text-sm font-medium text-text-primary">
          {offlineStatusLabel(summary)}
        </span>
        <button
          type="button"
          onClick={handleDownload}
          disabled={isDownloading}
          aria-busy={isDownloading || undefined}
          className={cn(
            'inline-flex flex-shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-semibold min-h-11',
            'transition-[background-color,transform] duration-[var(--duration-med)] ease-[var(--ease-out)]',
            'bg-accent-aqua text-bg-primary hover:bg-[var(--color-accent-aqua-hover)] active:scale-[0.97] motion-reduce:transform-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {offlineActionLabel(summary)}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label="Show offline download details"
          className="inline-flex flex-shrink-0 items-center justify-center w-11 h-11 rounded-xl text-text-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
        >
          <ChevronDown className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <div className="pb-3">
          <p className="text-xs text-text-secondary">{description}</p>
          <ul className="mt-3 divide-y divide-[var(--color-overlay-4)]" aria-label="Offline readiness checklist">
            {steps.map(({ key, label, section, detail }) => (
              <StepRow
                key={key}
                label={label}
                section={section}
                tick={tick}
                detail={detail}
                onRetry={section.status === 'error' ? handleDownload : undefined}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
