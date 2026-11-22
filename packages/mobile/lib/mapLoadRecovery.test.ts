import { describe, it, expect } from 'vitest';
import {
  COLD_LOAD_TIMEOUT_MS,
  WARM_LOAD_TIMEOUT_MS,
  STABLE_MS,
  initialRecovery,
  loadTimeoutMs,
  reduceRecovery,
  type RecoveryEvent,
  type RecoveryState,
} from './mapLoadRecovery';

function run(events: RecoveryEvent[], from: RecoveryState = initialRecovery) {
  let state = from;
  const actions = events.map((e) => {
    const r = reduceRecovery(state, e);
    state = r.state;
    return r.action;
  });
  return { state, actions };
}

describe('reduceRecovery', () => {
  it('remounts on the first failure, then shows the banner on the second', () => {
    expect(run([{ type: 'failure', now: 0 }, { type: 'failure', now: 1 }]).actions).toEqual(['remount', 'fallback']);
  });

  it('treats a load timeout like a failure only while loading', () => {
    expect(run([{ type: 'timeout', now: 0, loading: false }]).actions).toEqual(['none']);
    expect(run([{ type: 'timeout', now: 0, loading: true }]).actions).toEqual(['remount']);
  });

  it('ignores further failures once the banner shows', () => {
    const { actions } = run([
      { type: 'failure', now: 0 },
      { type: 'failure', now: 1 },
      { type: 'failure', now: 2 },
      { type: 'timeout', now: 3, loading: true },
    ]);
    expect(actions).toEqual(['remount', 'fallback', 'none', 'none']);
  });

  it('restores the remount budget on a manual retry', () => {
    const { actions, state } = run([
      { type: 'failure', now: 0 },
      { type: 'failure', now: 1 },
      { type: 'retry' },
      { type: 'failure', now: 2 },
    ]);
    expect(actions).toEqual(['remount', 'fallback', 'reload', 'remount']);
    expect(state.remounts).toBe(1);
  });

  it('does not record a ready that arrives after the banner', () => {
    const { state } = run([{ type: 'failure', now: 0 }, { type: 'failure', now: 1 }, { type: 'ready', now: 2 }]);
    expect(state.readyAt).toBeNull();
  });

  it('keeps the budget spent when the map dies again soon after ready', () => {
    const { actions } = run([
      { type: 'failure', now: 0 },
      { type: 'ready', now: 100 },
      { type: 'failure', now: 100 + STABLE_MS - 1 },
    ]);
    expect(actions).toEqual(['remount', 'none', 'fallback']);
  });

  it('refills the budget after the map stayed up for STABLE_MS', () => {
    const { actions } = run([
      { type: 'failure', now: 0 },
      { type: 'ready', now: 100 },
      { type: 'ready', now: 200 },
      { type: 'failure', now: 100 + STABLE_MS },
    ]);
    expect(actions).toEqual(['remount', 'none', 'none', 'remount']);
  });
});

describe('loadTimeoutMs', () => {
  it('gives the cold first load more time than the remount', () => {
    expect(loadTimeoutMs(initialRecovery)).toBe(COLD_LOAD_TIMEOUT_MS);
    expect(loadTimeoutMs({ ...initialRecovery, remounts: 1 })).toBe(WARM_LOAD_TIMEOUT_MS);
    expect(COLD_LOAD_TIMEOUT_MS).toBeGreaterThan(8000);
  });
});
