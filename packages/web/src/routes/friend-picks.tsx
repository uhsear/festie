import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore, useFestivalStore } from '@festie/shared/stores';
import { fetchSharedPicks, mapErrorToUserMessage, isApiClientError } from '@festie/shared/services';
import {
  compareSharedPicks,
  parseSharedPicksRef,
  planSharedPicksAdd,
  resolveStageColor,
  type ComparedSet,
} from '@festie/shared/utils';
import { COPY, PRIORITY_LABEL, signInTo } from '@festie/shared/constants';
import type { Priority } from '@festie/shared/types';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import StageBadge from '../components/ui/StageBadge';
import PriorityIcon from '../components/ui/PriorityIcon';
import { useToast } from '../lib/toastContext';

const BAD_LINK = "This link can't be read. Ask your friend to send it again.";
const NOT_FOUND = 'This link no longer works. Ask your friend for a new one.';
const OFFLINE = 'Connect to the internet to see these picks.';

function errorText(err: unknown): string {
  if (isApiClientError(err)) {
    if (err.status === 404) return NOT_FOUND;
    if (err.status === 0 && err.code === 'INVALID_INPUT') return BAD_LINK;
    if (err.status === 0) return OFFLINE;
  }
  return mapErrorToUserMessage(err);
}

// A bad or dead link never fixes itself; offline and generic failures can.
function isRetryable(err: unknown): boolean {
  return !(isApiClientError(err) && (err.status === 404 || (err.status === 0 && err.code === 'INVALID_INPUT')));
}

const plural = (n: number) => `${n} ${n === 1 ? 'pick' : 'picks'}`;

export default function FriendPicksView() {
  return (
    <RenderErrorBoundary name="friend-picks">
      <FriendPicksInner />
    </RenderErrorBoundary>
  );
}

function PriorityMark({ label, priority }: { label: string; priority?: Priority }) {
  if (!priority) return null;
  return (
    <span className="inline-flex items-center gap-1 type-meta text-text-secondary">
      <PriorityIcon priority={priority} className="w-3 h-3" filled />
      {label}: {PRIORITY_LABEL[priority]}
    </span>
  );
}

function Row({
  row,
  username,
  check,
}: {
  row: ComparedSet;
  username: string;
  check?: { ticked: boolean; onToggle: () => void };
}) {
  const mark = row.bucket === 'both' ? 'Both' : row.bucket === 'theirs' ? `Only ${username}` : 'Only you';
  return (
    <li className="flex flex-col gap-1 py-2 border-b border-border-subtle">
      <div className="flex items-center gap-2 flex-wrap">
        {check && (
          <input
            type="checkbox"
            className="w-5 h-5 shrink-0"
            checked={check.ticked}
            onChange={check.onToggle}
            aria-label={`${row.artist}, ${row.time}`}
          />
        )}
        <span className="type-meta text-text-muted tabular-nums">{row.time}</span>
        <span className="font-semibold">{row.artist}</span>
        {row.stage && (
          <StageBadge
            stageName={row.stage}
            stageColor={resolveStageColor(row.stageColor ?? undefined, 'var(--text-muted)')}
          />
        )}
        <span className="type-meta font-semibold ml-auto">{mark}</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        <PriorityMark label="Them" priority={row.theirs} />
        <PriorityMark label="You" priority={row.mine} />
      </div>
    </li>
  );
}

function Message({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <>
      <h1 className="sr-only">Friend picks</h1>
      <div className="max-w-2xl mx-auto py-8 px-4 text-center flex flex-col items-center gap-3" role="alert">
        {text}
        {onRetry && (
          <button type="button" className="btn-secondary min-h-11 px-4" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </>
  );
}

function Banner({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border-subtle p-3 flex flex-col gap-2">
      <p className="text-sm">{text}</p>
      <div className="flex gap-2 flex-wrap">{children}</div>
    </div>
  );
}

function FriendPicksInner() {
  const search = useSearch({ strict: false }) as { from?: string };
  const navigate = useNavigate();
  const { toast, toastUndo, toastError } = useToast();
  const user = useAuthStore((s) => s.user);
  const currentFestivalId = useFestivalStore((s) => s.currentFestivalId);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  // On a hard load the festival list is still empty, so a null current festival is not yet a real choice.
  const festivalsPending = useFestivalStore((s) => s.isLoading || (s.festivals.length === 0 && !s.error));
  const ref = parseSharedPicksRef(search.from);

  const query = useQuery({
    queryKey: ['shared-picks', ref],
    queryFn: () => fetchSharedPicks(ref as string),
    enabled: ref !== null,
    retry: false,
  });
  const payload = query.data;

  const mine = payload && currentFestivalId === payload.festivalId ? currentProfile?.picks : undefined;
  const comparison = useMemo(() => (payload ? compareSharedPicks(payload, mine) : null), [payload, mine]);

  const [userTicks, setUserTicks] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const ticked = useMemo(() => {
    if (userTicks) return userTicks;
    const initial = new Set<string>();
    for (const day of comparison?.days ?? []) {
      for (const row of day.rows) if (row.addable && row.theirs === 'must') initial.add(row.setId);
    }
    return initial;
  }, [userTicks, comparison]);

  useEffect(() => {
    if (!payload) return;
    document.title = `${payload.username}'s ${payload.festivalName} picks · Festie`;
  }, [payload]);

  const scrolled = useRef(false);
  useEffect(() => {
    if (!payload || scrolled.current || window.location.hash !== '#add') return;
    scrolled.current = true;
    document.getElementById('add')?.scrollIntoView();
  }, [payload]);

  if (ref === null) return <Message text={BAD_LINK} />;
  if (query.isPending) {
    return (
      <div className="max-w-2xl mx-auto py-8 text-center text-sm text-text-secondary" role="status">
        Loading picks…
      </div>
    );
  }
  if (query.isError || !payload || !comparison) {
    return (
      <Message
        text={errorText(query.error)}
        onRetry={query.isError && isRetryable(query.error) ? () => void query.refetch() : undefined}
      />
    );
  }

  const { username, festivalName } = payload;
  // No festival selected counts as another festival, as on mobile, so Switch is offered.
  const otherFestival = currentFestivalId !== payload.festivalId && !(currentFestivalId === null && festivalsPending);
  const notJoined = !otherFestival && !!user && !currentProfile;
  const canTick = !!user && mine !== undefined;
  const addableCount = comparison.days.flatMap((d) => d.rows).filter((r) => r.addable).length;
  const plan = planSharedPicksAdd(comparison, ticked);

  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setUserTicks(next);
  };

  const handleAdd = async () => {
    if (busy || plan.total === 0) return;
    setBusy(true);
    try {
      const store = useFestivalStore.getState();
      let added = 0;
      for (const [priority, ids] of Object.entries(plan.byPriority) as Array<[Priority, string[]]>) {
        added += await store.bulkSavePicks(ids, priority);
      }
      setUserTicks(new Set());
      toastUndo(`Added ${plural(added)} to your plan.`, () => {
        void useFestivalStore
          .getState()
          .restorePicks(plan.previous)
          .then(() => toast('Undone. Your plan is back to how it was.', 'success'))
          .catch((err: unknown) => toastError(err, "Couldn't undo. Try again."));
      });
    } catch (err) {
      toastError(err, "Couldn't add the picks. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 flex flex-col gap-4">
      <header>
        <h1 className="type-title">{`${username}'s ${festivalName} picks`}</h1>
        {mine !== undefined && (
          <p className="type-meta text-text-secondary">
            {`${comparison.counts.both} in common · ${comparison.counts.theirsOnly} only ${username} · ${comparison.counts.mineOnly} only you`}
          </p>
        )}
      </header>

      {!user ? (
        <Banner text={signInTo('compare these picks with yours')}>
          <button type="button" className="btn-primary min-h-11 px-4" onClick={() => navigate({ to: '/login' })}>
            {COPY.auth.signIn}
          </button>
          <button type="button" className="btn-secondary min-h-11 px-4" onClick={() => navigate({ to: '/register' })}>
            {COPY.auth.createAccount}
          </button>
        </Banner>
      ) : otherFestival ? (
        <Banner text={`These picks are for ${festivalName}.`}>
          <button
            type="button"
            className="btn-primary min-h-11 px-4"
            onClick={() => void useFestivalStore.getState().selectFestival(payload.festivalId)}
          >
            {`Switch to ${festivalName}`}
          </button>
        </Banner>
      ) : notJoined ? (
        <Banner text={`You haven't joined ${festivalName} yet. Join it to compare and add picks.`}>
          <button type="button" className="btn-primary min-h-11 px-4" onClick={() => navigate({ to: '/cards' })}>
            {`Open ${festivalName}`}
          </button>
        </Banner>
      ) : null}

      {comparison.days.map((day) => (
        <section key={day.dayIndex} aria-label={day.label}>
          <h2 className="type-heading mb-1">{day.label}</h2>
          <ul>
            {day.rows.map((row) => (
              <Row
                key={row.setId}
                row={row}
                username={username}
                check={canTick && row.addable ? { ticked: ticked.has(row.setId), onToggle: () => toggle(row.setId) } : undefined}
              />
            ))}
          </ul>
        </section>
      ))}
      {comparison.missing > 0 && (
        <p className="type-meta text-text-muted">{`${comparison.missing} of their picks are no longer in the lineup.`}</p>
      )}

      {canTick && (
        <section id="add" className="flex flex-col gap-2">
          <h2 className="type-heading">Add their picks to your plan</h2>
          {addableCount === 0 ? (
            <p className="text-sm">You already have all of their picks.</p>
          ) : (
            <>
              <p className="type-meta text-text-secondary">
                Their Must See picks are ticked. Nothing changes until you tap Add. A pick you already rated higher stays
                as it is.
              </p>
              {plan.total === 0 ? (
                <p className="text-sm">Tick the sets you want to add.</p>
              ) : (
                <button
                  type="button"
                  className="btn-primary min-h-11 px-4 self-start"
                  disabled={busy}
                  onClick={handleAdd}
                >
                  {`Add ${plan.total} to my plan`}
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
