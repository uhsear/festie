import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { api } from '@festie/shared/services';
import { PRIORITY_LABELS } from '@festie/shared/constants';
import type { Festival, FestivalDay, FestivalSet, Stage } from '@festie/shared/types';
import { artistDisplayName, decodePlanSnapshot, formatTime, fromPickPriority } from '@festie/shared/utils';

/** Shape returned by GET /festivals/:id (after envelope unwrap). */
interface FestivalDetailResponse extends Festival {
  stages: Stage[];
  days: (FestivalDay & { label?: string; sets: FestivalSet[] })[];
}

type LoadState = 'loading' | 'ready' | 'offline';

interface Row {
  key: string;
  artist: string;
  time: string;
  stage: string;
  priority: string;
}

/**
 * Read-only landing page for a plan QR: festie.us/p#<snapshot>. The snapshot
 * lives in the URL hash so it never reaches the server. Public and writes to no
 * store, so opening a friend's code never changes the viewer's own plan.
 */
export default function PlanSnapshotPage() {
  const [hash] = useState(() => window.location.hash.slice(1));
  const decoded = useMemo(() => decodePlanSnapshot(hash), [hash]);
  const snapshot = decoded.ok ? decoded.data : null;
  const [festival, setFestival] = useState<FestivalDetailResponse | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const festivalId = snapshot?.festivalId;
  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    api
      .get<FestivalDetailResponse>(`/festivals/${encodeURIComponent(festivalId)}`)
      .then((data) => {
        if (cancelled) return;
        setFestival(data);
        setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('offline');
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  const { groups, missing } = useMemo(() => {
    if (!snapshot || !festival) return { groups: [] as { label: string; rows: Row[] }[], missing: 0 };
    const stageNames = new Map((festival.stages ?? []).map((s) => [s.id, s.name]));
    const byId = new Map<string, { set: FestivalSet; dayLabel: string }>();
    for (const day of festival.days ?? []) {
      for (const set of day.sets ?? []) byId.set(set.id, { set, dayLabel: day.label || day.date });
    }
    const out = new Map<string, Row[]>();
    let notFound = 0;
    for (const pick of snapshot.picks) {
      const hit = byId.get(pick.setId);
      if (!hit) {
        notFound++;
        continue;
      }
      const rows = out.get(hit.dayLabel) ?? [];
      rows.push({
        key: pick.setId,
        artist: artistDisplayName(hit.set),
        time: hit.set.startTime ? formatTime(hit.set.startTime) : 'TBA',
        stage: hit.set.stageName || stageNames.get(hit.set.stageId) || '',
        priority: PRIORITY_LABELS[fromPickPriority(pick.priority)],
      });
      out.set(hit.dayLabel, rows);
    }
    return { groups: [...out].map(([label, rows]) => ({ label, rows })), missing: notFound };
  }, [snapshot, festival]);

  if (!snapshot) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-12 text-center" data-testid="plan-snapshot-error">
        <h1 className="type-heading text-text-primary">This plan code can&apos;t be read</h1>
        <p className="text-[length:var(--font-size-14)] text-text-secondary">Ask your friend to show the QR again.</p>
      </div>
    );
  }

  const count = snapshot.picks.length;
  const mp = snapshot.meetingPoint;

  return (
    <div className="flex flex-col gap-4 px-6 py-8 max-w-[640px] mx-auto" data-testid="plan-snapshot">
      <header>
        <h1 className="type-heading text-text-primary">{festival?.name ?? snapshot.festivalName}</h1>
        <p className="text-[length:var(--font-size-14)] text-text-secondary">
          A friend&apos;s picks · {count} {count === 1 ? 'set' : 'sets'}
        </p>
      </header>

      {mp && (
        <p className="text-[length:var(--font-size-14)] text-text-primary">
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${mp.lat},${mp.lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Meet at {mp.label}
          </a>
        </p>
      )}

      {state === 'offline' && (
        <p className="text-[length:var(--font-size-14)] text-text-secondary">
          Connect to the internet to see set names and times.
        </p>
      )}

      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h2 className="type-subheading text-text-primary">{g.label}</h2>
          <ul className="flex flex-col gap-2 mt-2 list-none p-0">
            {g.rows.map((r) => (
              <li key={r.key} className="flex flex-col">
                <span className="text-text-primary font-semibold">{r.artist}</span>
                <span className="text-[length:var(--font-size-13)] text-text-secondary">
                  {[r.time, r.stage, r.priority].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {missing > 0 && (
        <p className="text-[length:var(--font-size-13)] text-text-secondary">
          {missing} {missing === 1 ? 'pick is' : 'picks are'} no longer in the lineup.
        </p>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <Link
          to="/"
          className="inline-flex items-center justify-center min-h-11 px-6 rounded-lg bg-accent-aqua text-[var(--text-on-light-accent)] text-[length:var(--font-size-14)] font-semibold no-underline"
        >
          Plan your own picks
        </Link>
        <p className="text-[length:var(--font-size-13)] text-text-secondary">
          Have Festie? Open Share picks › Scan QR and scan the code instead.
        </p>
      </div>
    </div>
  );
}
