import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { api, isApiClientError } from '@festie/shared/services';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import { COPY, PRIORITY_LABELS, planBLine, signInTo } from '@festie/shared/constants';
import type { Festival, FestivalDay, FestivalSet, Priority, Stage } from '@festie/shared/types';
import {
  applyPlanImport,
  artistDisplayName,
  byStartTime,
  decodePlanSnapshot,
  formatTime,
  fromPickPriority,
  previewPlanImport,
  type PlanSnapshot,
} from '@festie/shared/utils';
import { useToast } from '../lib/toastContext';
import { ArtistNameButton } from '../components/features/ArtistName';

/** Shape returned by GET /festivals/:id (after envelope unwrap). */
interface FestivalDetailResponse extends Festival {
  stages: Stage[];
  days: (FestivalDay & { label?: string; sets: FestivalSet[] })[];
}

type LoadState = 'loading' | 'ready' | 'offline' | 'gone';

interface Row {
  key: string;
  artist: string;
  time: string;
  stage: string;
  priority: string;
}

// The hash waits here (this tab only) while a signed-out visitor signs in, and /p reads it back. It never goes
// into the sign-in return path: that is a query string, which reaches the server and its logs. Every sign-in
// link on /p returns to plain /p, so the stash is written when the page opens, not when one link is tapped.
const PENDING_PLAN_KEY = 'fk.pendingPlanSnapshot';

function readHash(): string {
  const fromUrl = window.location.hash.slice(1);
  if (fromUrl) return fromUrl;
  try {
    return sessionStorage.getItem(PENDING_PLAN_KEY) ?? '';
  } catch {
    return ''; // sessionStorage unavailable: the visitor opens the link again
  }
}

const BUTTON =
  'inline-flex items-center justify-center min-h-11 px-6 rounded-lg text-[length:var(--font-size-14)] font-semibold no-underline';
const PRIMARY = `${BUTTON} bg-accent-aqua text-[var(--text-on-light-accent)]`;

/** Add-to-my-plan for a signed-in viewer, or a sign-in prompt that returns to this same link. Nothing is written until Add. */
function ImportPlan({ snapshot }: { snapshot: PlanSnapshot }) {
  const { toast, toastUndo, toastError } = useToast();
  const user = useAuthStore((s) => s.user);
  const currentFestivalId = useFestivalStore((s) => s.currentFestivalId);
  const storeProfile = useFestivalStore((s) => s.currentProfile);
  const sets = useFestivalStore((s) => s.sets);
  // Selecting a festival sets its id at once, but the sets and the profile still belong to the previous festival until the fetch ends.
  const isLoading = useFestivalStore((s) => s.isLoading);
  const loadFailed = useFestivalStore((s) => !!s.error);
  const currentProfile = storeProfile?.festivalId === snapshot.festivalId ? storeProfile : null;
  const [busy, setBusy] = useState(false);

  const preview = useMemo(
    () =>
      previewPlanImport(snapshot, {
        currentFestivalId,
        picks: currentProfile?.picks as Record<string, Priority> | undefined,
        setIds: new Set(sets.map((set) => set.id)),
      }),
    [snapshot, currentFestivalId, currentProfile, sets],
  );

  const add = async () => {
    if (busy || preview.toAdd.length === 0) return;
    setBusy(true);
    try {
      const added = await applyPlanImport(preview, (ids, priority) => useFestivalStore.getState().bulkSavePicks(ids, priority));
      toastUndo(`Added ${added} ${added === 1 ? 'pick' : 'picks'} to your plan.`, () => {
        void useFestivalStore
          .getState()
          .restorePicks(preview.previous)
          .then(() => toast('Undone. Your plan is back to how it was.', 'success'))
          .catch((err: unknown) => toastError(err, "Couldn't undo. Try again."));
      });
    } catch (err) {
      toastError(err, "Couldn't add the picks. Try again.");
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (!user) {
    body = (
      <>
        <p className="text-[length:var(--font-size-14)] text-text-primary">{signInTo('add these picks to your plan')}</p>
        <div className="flex gap-2 flex-wrap">
          <Link to="/login" search={{ next: '/p' }} className={PRIMARY}>
            {COPY.auth.signIn}
          </Link>
          <Link to="/register" search={{ next: '/p' }} className={`${BUTTON} border border-border-subtle text-text-primary`}>
            {COPY.auth.createAccount}
          </Link>
        </div>
      </>
    );
  } else if (currentFestivalId !== snapshot.festivalId) {
    body = (
      <>
        <p className="text-[length:var(--font-size-14)] text-text-primary">These picks are for {snapshot.festivalName}.</p>
        <button type="button" className={PRIMARY} onClick={() => void useFestivalStore.getState().selectFestival(snapshot.festivalId)}>
          Switch to {snapshot.festivalName}
        </button>
      </>
    );
  } else if (isLoading) {
    body = (
      <p role="status" className="text-[length:var(--font-size-14)] text-text-secondary">
        Loading your plan…
      </p>
    );
  } else if (!currentProfile && loadFailed) {
    body = (
      <>
        <p className="text-[length:var(--font-size-14)] text-text-primary">Couldn&apos;t load your plan. Check your connection, then try again.</p>
        <button type="button" className={PRIMARY} onClick={() => void useFestivalStore.getState().selectFestival(snapshot.festivalId)}>
          Try again
        </button>
      </>
    );
  } else if (!currentProfile) {
    body = (
      <>
        <p className="text-[length:var(--font-size-14)] text-text-primary">
          You haven&apos;t joined {snapshot.festivalName} yet. Join it to add these picks.
        </p>
        <Link to="/cards" className={PRIMARY}>
          Open {snapshot.festivalName}
        </Link>
      </>
    );
  } else if (preview.toAdd.length === 0) {
    body = <p className="text-[length:var(--font-size-14)] text-text-primary">You already have all of these picks.</p>;
  } else {
    body = (
      <>
        <p className="text-[length:var(--font-size-13)] text-text-secondary">
          Nothing changes until you tap Add. A pick you already rated higher stays as it is.
        </p>
        <button type="button" disabled={busy} onClick={add} className={`${PRIMARY} disabled:opacity-50`}>
          Add {preview.toAdd.length} to my plan
        </button>
      </>
    );
  }
  return (
    <section aria-label="Add to my plan" className="flex flex-col gap-2 items-start">
      {body}
    </section>
  );
}

/**
 * Landing page for a plan QR: festie.us/p#<snapshot>. The snapshot lives in the URL hash so it never reaches
 * the server. Public: anyone can read it. A signed-in viewer may add the picks to their own plan, but only after
 * a tap on Add (see ImportPlan), so opening a friend's code alone never changes the viewer's plan.
 */
export default function PlanSnapshotPage() {
  const [hash] = useState(readHash);
  const user = useAuthStore((s) => s.user);
  // A signed-out visitor opening the link keeps the hash for the trip through sign-in. While signed out the stash
  // stays, even when the URL has no hash: the page re-mounts at /login?next=/p and must not delete what it just read.
  // It is dropped once the viewer is signed in. Clearing here, not in readHash, keeps StrictMode's double init safe.
  useEffect(() => {
    try {
      if (user) sessionStorage.removeItem(PENDING_PLAN_KEY);
      else if (window.location.hash) sessionStorage.setItem(PENDING_PLAN_KEY, hash);
    } catch {
      // sessionStorage unavailable: the visitor opens the link again after signing in
    }
  }, [user, hash]);
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
      .catch((err: unknown) => {
        if (!cancelled) setState(isApiClientError(err) && err.status === 404 ? 'gone' : 'offline');
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  const { groups, missing } = useMemo(() => {
    if (!snapshot || !festival) return { groups: [] as { label: string; rows: Row[] }[], missing: 0 };
    const stageNames = new Map((festival.stages ?? []).map((s) => [s.id, s.name]));
    const priorityBySetId = new Map(snapshot.picks.map((p) => [p.setId, p.priority]));
    const dayGroups: { label: string; rows: Row[] }[] = [];
    let found = 0;
    // Festival day order, then start time: the snapshot itself is ranked by priority.
    for (const day of festival.days ?? []) {
      const rows = (day.sets ?? [])
        .filter((set) => priorityBySetId.has(set.id))
        .sort(byStartTime)
        .map((set) => ({
          key: set.id,
          artist: artistDisplayName(set, festival.b2bSeparator),
          time: set.startTime ? formatTime(set.startTime) : 'TBA',
          stage: set.stageName || stageNames.get(set.stageId) || '',
          priority: PRIORITY_LABELS[fromPickPriority(priorityBySetId.get(set.id)!)],
        }));
      found += rows.length;
      if (rows.length > 0) dayGroups.push({ label: day.label || day.date, rows });
    }
    return { groups: dayGroups, missing: snapshot.picks.length - found };
  }, [snapshot, festival]);

  if (!snapshot) {
    return (
      <div className="flex flex-col items-center gap-4 px-6 py-12 text-center" data-testid="plan-snapshot-error">
        <h1 className="type-heading text-text-primary">This plan code can&apos;t be read</h1>
        <p className="text-[length:var(--font-size-14)] text-text-secondary">Ask your friend to show the QR again.</p>
      </div>
    );
  }

  // Once the lineup loads, count only the sets still in it, so the header matches the rows and the footer line.
  const count = state === 'gone' ? 0 : snapshot.picks.length - (state === 'ready' ? missing : 0);
  const mp = snapshot.meetingPoint;
  const planB = 'planB' in snapshot ? snapshot.planB : undefined;

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
            className="inline-flex min-h-11 items-center underline"
          >
            Meet at {mp.label}
          </a>
        </p>
      )}

      {planB && <p className="text-[length:var(--font-size-14)] text-text-primary break-words">{planBLine(planB)}</p>}

      {state === 'offline' && (
        <p className="text-[length:var(--font-size-14)] text-text-secondary">
          Connect to the internet to see set names and times.
        </p>
      )}

      {state === 'gone' && (
        <p className="text-[length:var(--font-size-14)] text-text-secondary">This festival is no longer available.</p>
      )}

      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h2 className="type-subheading text-text-primary">{g.label}</h2>
          <ul className="flex flex-col gap-2 mt-2 list-none p-0">
            {g.rows.map((r) => (
              <li key={r.key} className="flex flex-col">
                <span className="text-text-primary font-semibold">
                  <ArtistNameButton name={r.artist} />
                </span>
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

      {state !== 'gone' && <ImportPlan snapshot={snapshot} />}

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
