import { useEffect, useMemo, useState } from 'react';
import { runArtistBackfill } from '@festie/shared/services';
import type { ArtistBackfillRunResult, ArtistBackfillVerify } from '@festie/shared/services';
import { ApiClientError } from '@festie/shared/services/api';
import { withReauth } from '@festie/shared/services/admin';
import {
  classifyBackfillReport,
  describeBackfillEntry,
  isIdempotentPlan,
  type BackfillFinding,
  type BackfillReportInput,
} from '@festie/shared/utils';
import { useReauthPrompt } from '../../hooks/useReauthPrompt';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

/** A dry run older than this no longer matches what the admin reviewed closely enough to run. */
const DRY_RUN_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_LIST_ROWS = 200;

interface DryRun {
  report: BackfillReportInput;
  planHash: string;
  at: number;
}

interface Outcome {
  run: ArtistBackfillRunResult;
  verify: ArtistBackfillVerify | null;
  second: BackfillReportInput | null;
  followUpError: string | null;
}

const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0);

function errorText(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.code === 'PLAN_CHANGED') return 'Data changed since your dry run, run it again.';
    if (err.status === 409) return 'A backfill is already running. Wait for it to finish, then press Verify.';
    const runId = err.details?.runId;
    if (typeof runId === 'string' && err.status >= 500) {
      return `The run stopped part way (run ${runId}). Press Verify and Dry run to see what was written.`;
    }
    if (err.message) return err.message;
  }
  return "Couldn't reach the server. Try again.";
}

function FindingList({ title, items, tone }: { title: string; items: BackfillFinding[]; tone: 'stop' | 'review' }) {
  if (items.length === 0) return null;
  const color = tone === 'stop' ? 'text-accent-coral border-accent-coral' : 'text-text-primary border-glass-border';
  return (
    <section aria-label={title} className={`rounded-lg border p-3 space-y-2 ${color}`}>
      <h3 className="text-sm font-semibold">
        {title} ({items.length})
      </h3>
      <ul className="list-none p-0 space-y-2 text-sm">
        {items.map((item) => (
          <li key={item.kind}>
            <div className="font-medium">
              {item.kind}: {item.count}
            </div>
            <ul className="list-none p-0 text-xs break-words text-text-secondary">
              {item.examples.map((example, i) => (
                <li key={i}>{example}</li>
              ))}
              {item.count > item.examples.length && <li>and more in the list below</li>}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReportLists({ report, stopKinds, reviewKinds }: { report: BackfillReportInput; stopKinds: Set<string>; reviewKinds: Set<string> }) {
  // Any array in the report is shown, so a list the server adds later appears without a change here.
  const lists = Object.entries(report).filter(([, v]) => Array.isArray(v) && v.length > 0) as Array<[string, unknown[]]>;
  return (
    <div className="space-y-2">
      {lists.map(([key, entries]) => (
        <details key={key} className="rounded-lg border border-glass-border p-2">
          <summary className="cursor-pointer min-h-11 flex items-center text-sm text-text-primary">
            {key} ({entries.length})
            {stopKinds.has(key) && <span className="ml-2 text-accent-coral">STOP</span>}
            {!stopKinds.has(key) && reviewKinds.has(key) && <span className="ml-2 text-text-muted">review</span>}
          </summary>
          <ul className="list-none p-0 max-h-64 overflow-auto space-y-1 text-xs break-words text-text-secondary">
            {entries.slice(0, MAX_LIST_ROWS).map((entry, i) => (
              <li key={i}>{describeBackfillEntry(entry)}</li>
            ))}
            {entries.length > MAX_LIST_ROWS && <li>and {entries.length - MAX_LIST_ROWS} more</li>}
          </ul>
        </details>
      ))}
    </div>
  );
}

function Counts({ counts }: { counts: Record<string, number> }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
      {Object.entries(counts).map(([key, value]) => (
        <div key={key} className="flex justify-between gap-2">
          <dt className="text-text-muted break-all">{key}</dt>
          <dd className="text-text-primary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Admin, web only: the artist id backfill. Dry run shows what would change and sorts it into STOP and REVIEW.
 * Run needs a dry run younger than 15 minutes, a ticked box when STOP items exist, a confirm step and a recent
 * password check. After a run it verifies and plans again: a second plan with nothing to write proves it stuck.
 */
export default function AdminArtistBackfill() {
  const { askPassword, reauthDialog } = useReauthPrompt();
  const [dry, setDry] = useState<DryRun | null>(null);
  const [verify, setVerify] = useState<ArtistBackfillVerify | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'dry-run' | 'run' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const review = useMemo(() => (dry ? classifyBackfillReport(dry.report) : null), [dry]);
  const stale = dry !== null && now - dry.at > DRY_RUN_MAX_AGE_MS;
  const stopCount = review?.stop.length ?? 0;
  const canRun = dry !== null && !stale && busy === null && (stopCount === 0 || reviewed);

  const planNow = async (): Promise<DryRun> => {
    const res = await runArtistBackfill('dry-run');
    if (!res.report || !res.planHash) throw new Error('The server sent no report. Try again.');
    return { report: res.report, planHash: res.planHash, at: Date.now() };
  };

  const doDryRun = async () => {
    setBusy('dry-run');
    setError(null);
    setOutcome(null);
    setReviewed(false);
    try {
      const next = await planNow();
      setDry(next);
      setNow(Date.now());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const doVerify = async () => {
    setBusy('verify');
    setError(null);
    try {
      const res = await runArtistBackfill('verify');
      setVerify((res.result as ArtistBackfillVerify) ?? null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const followUp = async (run: ArtistBackfillRunResult) => {
    // Verify and a second plan both read only; a failure here must not hide that the run succeeded.
    const next: Outcome = { run, verify: null, second: null, followUpError: null };
    try {
      next.verify = ((await runArtistBackfill('verify')).result as ArtistBackfillVerify) ?? null;
      next.second = (await runArtistBackfill('dry-run')).report ?? null;
    } catch (err) {
      next.followUpError = errorText(err);
    }
    setOutcome(next);
  };

  const doRun = async () => {
    if (!dry || Date.now() - dry.at > DRY_RUN_MAX_AGE_MS) {
      setError('The dry run is older than 15 minutes. Run it again.');
      return;
    }
    setConfirming(false);
    setBusy('run');
    setError(null);
    setVerify(null);
    try {
      const res = await withReauth(() => runArtistBackfill('run', dry.planHash), askPassword, { retryWrongPassword: true });
      if (res === null) {
        setError('The run was cancelled: your password was not confirmed. Nothing was written.');
        return;
      }
      setDry(null);
      setReviewed(false);
      await followUp(res.result as ArtistBackfillRunResult);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'PLAN_CHANGED') setDry(null);
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const stopKinds = new Set(review?.stop.map((f) => f.kind));
  const reviewKinds = new Set(review?.review.map((f) => f.kind));
  const counts = dry?.report.counts;
  const buttonClass = 'w-full sm:w-auto';

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="text-lg text-text-primary">Artist backfill</h2>
        <p className="text-sm text-text-muted">
          Gives every artist on every festival an artist record. Start with a dry run. It writes nothing.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <Button className={buttonClass} disabled={busy !== null} isLoading={busy === 'dry-run'} onClick={() => void doDryRun()}>
          Dry run
        </Button>
        <Button
          className={buttonClass}
          variant="secondary"
          disabled={busy !== null}
          isLoading={busy === 'verify'}
          onClick={() => void doVerify()}
        >
          Verify
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-accent-coral">
          {error}
        </p>
      )}

      {verify && (
        <section aria-label="Verify result" className="rounded-lg border border-glass-border p-3 space-y-1 text-sm">
          <h3 className={verify.ok ? 'text-accent-aqua' : 'text-accent-coral'}>{verify.ok ? 'Verify passed' : 'Verify failed'}</h3>
          <ul className="list-none p-0 break-words">
            {verify.checks.map((c) => (
              <li key={c.name} className={c.ok ? 'text-text-secondary' : 'text-accent-coral'}>
                {c.ok ? 'ok' : 'FAIL'} {c.name}
                {c.ok || c.details == null ? '' : `: ${typeof c.details === 'string' ? c.details : JSON.stringify(c.details)}`}
              </li>
            ))}
          </ul>
          {verify.skipped.length > 0 && <p className="text-text-muted">Skipped: {verify.skipped.length}</p>}
        </section>
      )}

      {dry && review && (
        <div className="space-y-3">
          <p className="text-xs text-text-muted">
            Dry run at {new Date(dry.at).toLocaleTimeString()}.{' '}
            {stale && <span className="text-accent-coral">It is older than 15 minutes. Run it again before you run the backfill.</span>}
          </p>
          {counts && <Counts counts={counts} />}
          <FindingList title="STOP" items={review.stop} tone="stop" />
          <FindingList title="REVIEW" items={review.review} tone="review" />
          {review.stop.length === 0 && <p className="text-sm text-accent-aqua">No STOP items.</p>}
          <ReportLists report={dry.report} stopKinds={stopKinds} reviewKinds={reviewKinds} />

          {stopCount > 0 && (
            <label className="flex items-start gap-2 min-h-11 text-sm text-text-primary">
              <input type="checkbox" className="mt-1" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
              <span>I reviewed the STOP items</span>
            </label>
          )}
        </div>
      )}

      <Button className={buttonClass} variant="primary" disabled={!canRun} isLoading={busy === 'run'} onClick={() => setConfirming(true)}>
        Run backfill
      </Button>

      {outcome && (
        <section aria-label="Run result" className="rounded-lg border border-glass-border p-3 space-y-2 text-sm">
          <h3 className="text-text-primary">Backfill finished</h3>
          <p className="break-all">Run id: {outcome.run.runId}</p>
          <p>Festivals written: {countOf(outcome.run.festivalsWritten)}</p>
          <p>Festivals skipped: {countOf(outcome.run.festivalsSkipped)}</p>
          <p>Artists created: {outcome.run.artistsCreated}</p>
          {countOf(outcome.run.conflicts) > 0 && <p className="text-accent-coral">Conflicts: {countOf(outcome.run.conflicts)}</p>}
          {outcome.verify && (
            <p className={outcome.verify.ok ? 'text-accent-aqua' : 'text-accent-coral'}>
              {outcome.verify.ok ? 'Verify passed.' : `Verify failed: ${outcome.verify.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`}
            </p>
          )}
          {outcome.second &&
            (isIdempotentPlan(outcome.second) ? (
              <p className="text-accent-aqua">Second dry run: zero changes</p>
            ) : (
              <p className="text-accent-coral">
                Second dry run still has changes:{' '}
                {['artistsToCreate', 'festivalsToWrite', 'ownersToWrite'].map((k) => `${k} ${outcome.second?.counts?.[k] ?? 0}`).join(', ')}
              </p>
            ))}
          {outcome.followUpError && (
            <p className="text-accent-coral">Verify and the second dry run did not finish: {outcome.followUpError} Press Verify and Dry run.</p>
          )}
        </section>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Run the artist backfill?"
        description={`This writes artist records for ${counts?.festivalsToWrite ?? 0} festivals: ${counts?.artistsToCreate ?? 0} artists to create, ${counts?.ownersToWrite ?? 0} sets and lineup entries to write. It asks for your password.`}
        confirmLabel="Run backfill"
        destructive
        onConfirm={() => void doRun()}
      />
      {reauthDialog}
    </div>
  );
}
