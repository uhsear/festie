import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';

const runArtistBackfill = vi.fn();
const askPassword = vi.fn();
const reauthPost = vi.fn();

vi.mock('@festie/shared/services', async (orig) => ({
  ...(await orig<typeof import('@festie/shared/services')>()),
  runArtistBackfill: (...a: unknown[]) => runArtistBackfill(...a),
}));
vi.mock('@festie/shared/services/api', async (orig) => {
  const mod = await orig<typeof import('@festie/shared/services/api')>();
  return { ...mod, api: { ...mod.api, post: (...a: unknown[]) => reauthPost(...a) } };
});
vi.mock('../../hooks/useReauthPrompt', () => ({ useReauthPrompt: () => ({ askPassword, reauthDialog: null }) }));

import { ApiClientError } from '@festie/shared/services/api';
import AdminArtistBackfill from './AdminArtistBackfill';

const HASH = 'a'.repeat(64);
const cleanCounts = { festivals: 2, festivalsToWrite: 2, artistsToCreate: 5, ownersToWrite: 9 };
const zeroCounts = { festivals: 2, festivalsToWrite: 0, artistsToCreate: 0, ownersToWrite: 0 };
const cleanReport = { counts: cleanCounts, joinedBySpotify: [{ artist: 'Moss Quartet', names: ['Moss Quartet', 'moss quartet'] }] };
const stopReport = {
  counts: cleanCounts,
  renames: [{ festivalId: 'fest-one', setId: 'set-1', before: 'Zed Zebra', after: 'Zed Zebras' }],
  rowFills: [{ festivalId: 'fest-one', ownerId: 'set-2', name: 'Pat Pending' }],
};
const dryResponse = (report: object, planHash = HASH) => ({ mode: 'dry-run', report, planHash });
const runResult = { runId: 'abr_test1', festivalsWritten: ['fest-one', 'fest-two'], festivalsSkipped: [], artistsCreated: 5, conflicts: [] };
const verifyOk = { mode: 'verify', result: { ok: true, checks: [{ name: 'ids present', ok: true }], skipped: [] } };

const apiError = (status: number, code: string, details?: Record<string, unknown>) =>
  new ApiClientError('server said no', status, code, undefined, false, details);

const dryRunWith = async (report: object) => {
  runArtistBackfill.mockResolvedValueOnce(dryResponse(report));
  fireEvent.click(screen.getByRole('button', { name: 'Dry run' }));
  await screen.findByText(/Dry run at/);
};
const runButton = () => screen.getByRole('button', { name: 'Run backfill' });
const confirmRun = () => {
  fireEvent.click(runButton());
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Run backfill' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  reauthPost.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

describe('AdminArtistBackfill', () => {
  it('shows counts, STOP items and review lists after a dry run, including unknown lists', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(stopReport);
    expect(runArtistBackfill).toHaveBeenCalledWith('dry-run');
    expect(screen.getByText('Artists to create')).toBeTruthy();
    const stop = screen.getByRole('region', { name: 'STOP' });
    expect(within(stop).getByText(/fest-one \| set-1 \| Zed Zebra -> Zed Zebras/)).toBeTruthy();
    expect(screen.getByText(/Artist records to fill from Spotify \(1\)/)).toBeTruthy();
  });

  it('shows REVIEW findings without a STOP', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    expect(screen.getByRole('region', { name: 'REVIEW' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'STOP' })).toBeNull();
    expect(screen.getByText('Nothing stops the run.')).toBeTruthy();
  });

  it('keeps Run disabled with no dry run, and with a STOP item until the box is ticked', async () => {
    render(<AdminArtistBackfill />);
    expect((runButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Run a dry run first/)).toBeTruthy();
    await dryRunWith(stopReport);
    expect((runButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I reviewed the STOP items'));
    expect((runButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables Run when the dry run is older than 15 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    expect((runButton() as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(16 * 60 * 1000);
    });
    expect((runButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/older than 15 minutes/)).toBeTruthy();
  });

  it('confirms with counts, sends the planHash, then verifies and plans again', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    runArtistBackfill
      .mockResolvedValueOnce({ mode: 'run', report: cleanReport, result: runResult })
      .mockResolvedValueOnce(verifyOk)
      .mockResolvedValueOnce(dryResponse({ counts: zeroCounts }));
    fireEvent.click(runButton());
    expect(screen.getByRole('dialog').textContent).toMatch(/5 artists to create/);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Run backfill' }));
    await screen.findByText('Second dry run: zero changes');
    expect(runArtistBackfill.mock.calls.map((c) => c[0])).toEqual(['dry-run', 'run', 'verify', 'dry-run']);
    expect(runArtistBackfill.mock.calls[1]).toEqual(['run', HASH]);
    expect(screen.getByText(/abr_test1/)).toBeTruthy();
    expect(screen.getByText('Artists created: 5')).toBeTruthy();
    expect(screen.getByText('Verify passed.')).toBeTruthy();
    // The reviewed plan is spent: a new dry run is needed before another run.
    expect((runButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows remaining counts in red when the second dry run still has changes', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    runArtistBackfill
      .mockResolvedValueOnce({ mode: 'run', report: cleanReport, result: runResult })
      .mockResolvedValueOnce(verifyOk)
      .mockResolvedValueOnce(dryResponse({ counts: { ...zeroCounts, ownersToWrite: 3 } }));
    confirmRun();
    const line = await screen.findByText(/Second dry run still has changes/);
    expect(line.textContent).toMatch(/Sets and lineup entries to update 3/);
    expect(line.className).toMatch(/coral/);
  });

  it('asks for the password on REAUTH_REQUIRED and retries the run once with the same planHash', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    askPassword.mockResolvedValueOnce('pw');
    runArtistBackfill
      .mockRejectedValueOnce(apiError(403, 'REAUTH_REQUIRED'))
      .mockResolvedValueOnce({ mode: 'run', report: cleanReport, result: runResult })
      .mockResolvedValueOnce(verifyOk)
      .mockResolvedValueOnce(dryResponse({ counts: zeroCounts }));
    confirmRun();
    await screen.findByText('Second dry run: zero changes');
    expect(askPassword).toHaveBeenCalledTimes(1);
    expect(reauthPost).toHaveBeenCalledWith('/auth/reauth', { password: 'pw' });
    expect(runArtistBackfill.mock.calls.filter((c) => c[0] === 'run')).toEqual([['run', HASH], ['run', HASH]]);
  });

  it('writes nothing and says so when the password prompt is cancelled', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    askPassword.mockResolvedValueOnce(null);
    runArtistBackfill.mockRejectedValueOnce(apiError(403, 'REAUTH_REQUIRED'));
    confirmRun();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Nothing was written/);
  });

  it('tells the admin to dry run again on PLAN_CHANGED and drops the stale plan', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    runArtistBackfill.mockRejectedValueOnce(apiError(409, 'PLAN_CHANGED'));
    confirmRun();
    expect((await screen.findByRole('alert')).textContent).toBe('Data changed since your dry run, run it again.');
    await waitFor(() => expect((runButton() as HTMLButtonElement).disabled).toBe(true));
  });

  it('says a run is already in progress on 409 ALREADY_EXISTS', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    runArtistBackfill.mockRejectedValueOnce(apiError(409, 'ALREADY_EXISTS'));
    confirmRun();
    expect((await screen.findByRole('alert')).textContent).toMatch(/already running.*Verify/);
  });

  it('shows the runId when the run stops part way', async () => {
    render(<AdminArtistBackfill />);
    await dryRunWith(cleanReport);
    runArtistBackfill.mockRejectedValueOnce(apiError(503, 'SERVICE_UNAVAILABLE', { runId: 'abr_part9' }));
    confirmRun();
    expect((await screen.findByRole('alert')).textContent).toMatch(/abr_part9.*Verify and Dry run/);
  });

  it('runs Verify on demand and shows failed checks', async () => {
    render(<AdminArtistBackfill />);
    runArtistBackfill.mockResolvedValueOnce({ mode: 'verify', result: { ok: false, checks: [{ name: 'ids present', ok: false, details: '3 missing' }], skipped: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Verify failed')).toBeTruthy();
    expect(screen.getByText(/FAIL ids present: 3 missing/)).toBeTruthy();
    expect(runArtistBackfill).toHaveBeenCalledWith('verify');
  });
});
