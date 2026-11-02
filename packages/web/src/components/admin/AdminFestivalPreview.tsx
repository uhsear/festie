import React, { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { fetchFestivalPreview } from '@festie/shared/services/admin';
import { resolveStageColor } from '@festie/shared/utils';
import Button from '../ui/Button';

type Preview = Awaited<ReturnType<typeof fetchFestivalPreview>>;

const colorFor = (color: string | undefined) => resolveStageColor(color, 'var(--text-muted)');

/** Read-only view of what attendees see. Never touches the admin's own festival selection. */
export default function AdminFestivalPreview({ festivalId }: { festivalId: string }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dayIndex, setDayIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    setDayIndex(0);
    fetchFestivalPreview(festivalId)
      .then((p) => !cancelled && setPreview(p))
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the preview. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  const back = (
    <Button
      type="button"
      variant="secondary"
      onClick={() => navigate({ to: '/admin', search: { tab: 'festivals' } })}
      className="min-h-11"
    >
      Back to festivals
    </Button>
  );

  if (error) {
    return (
      <div className="space-y-4">
        {back}
        <div role="alert" className="text-accent-coral">
          {error}
        </div>
      </div>
    );
  }
  if (!preview) return <div className="text-center py-12 text-text-muted">Loading preview…</div>;

  const day = preview.days[dayIndex];
  return (
    <div className="space-y-6">
      {back}
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Preview: {preview.name}</h1>
        <p className="text-sm text-text-muted">What attendees see. Read-only. Your own festival does not change.</p>
        <p className="text-sm text-text-secondary mt-1">
          {[preview.dateRange, preview.location].filter(Boolean).join(' · ')}
        </p>
      </div>

      {preview.warnings.length > 0 && (
        <ul className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-400 list-disc list-inside">
          {preview.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <div role="tablist" aria-label="Festival days" className="flex flex-wrap gap-2">
        {preview.days.map((d, i) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={i === dayIndex}
            onClick={() => setDayIndex(i)}
            className={`px-4 py-2 min-h-11 rounded-lg text-sm font-medium ${
              i === dayIndex ? 'bg-accent-aqua/20 text-accent-aqua' : 'bg-bg-card text-text-muted'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      {day && (
        <ul className="divide-y divide-glass-border rounded-lg border border-glass-border bg-bg-card/60">
          {day.sets.map((set) => (
            <li key={set.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: colorFor(set.stageColor) }}
              />
              <span className="w-32 shrink-0 text-text-muted">{set.time}</span>
              <span className="flex-1 text-text-primary">{set.artist}</span>
              <span className="text-text-muted">{set.stageName}</span>
            </li>
          ))}
        </ul>
      )}

      <div>
        <h2 className="type-label text-text-primary mb-2">Stages</h2>
        <ul className="space-y-1">
          {preview.stages.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: colorFor(s.color) }}
              />
              <span className="text-text-primary">{s.name}</span>
              <span className="text-text-muted">{s.pinned ? 'On map' : 'No map pin'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
