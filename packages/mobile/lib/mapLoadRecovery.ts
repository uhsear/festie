// mapLoadRecovery — decides what OfflineMap does when its WebView fails to come
// up. Framework-free so it can be unit-tested without mounting a WebView.
//
// The first WebView of a cold app can stall past the load timeout (on the Android
// emulator the first load took more than 8 s). The component then drops the WebView
// and the OS reaps its sandboxed renderer as "isolated not needed"; that log line is
// the aftermath of the timeout, not a crash signal. A real renderer loss reaches
// onRenderProcessGone / onContentProcessDidTerminate. Both routes land here: the
// first failure remounts once, and only a second failure shows "The map didn't load".

/** Automatic remounts allowed before the banner and "Retry map" button show. */
export const MAX_AUTO_REMOUNTS = 1;
/** Load window for the first WebView of a cold app (WebView and renderer start are slow). */
export const COLD_LOAD_TIMEOUT_MS = 15000;
/** Load window for the remounted WebView, which starts on a warm WebView provider. */
export const WARM_LOAD_TIMEOUT_MS = 10000;
/** A map that stayed up this long earns back the automatic remount; a renderer that keeps dying from OOM does not. */
export const STABLE_MS = 30000;

export interface RecoveryState {
  /** Automatic remounts since the last manual retry or stable period. */
  remounts: number;
  fellBack: boolean;
  /** When 'ready' first arrived since the last remount, or null. */
  readyAt: number | null;
}

export const initialRecovery: RecoveryState = { remounts: 0, fellBack: false, readyAt: null };

export type RecoveryEvent =
  | { type: 'failure'; now: number }
  | { type: 'timeout'; now: number; loading: boolean }
  | { type: 'ready'; now: number }
  | { type: 'retry' };

/** none: ignore. remount: new WebView key. fallback: show the banner. reload: manual retry. */
export type RecoveryAction = 'none' | 'remount' | 'fallback' | 'reload';

export function loadTimeoutMs(state: RecoveryState): number {
  return state.remounts === 0 ? COLD_LOAD_TIMEOUT_MS : WARM_LOAD_TIMEOUT_MS;
}

export function reduceRecovery(
  state: RecoveryState,
  event: RecoveryEvent,
): { state: RecoveryState; action: RecoveryAction } {
  switch (event.type) {
    case 'retry':
      return { state: initialRecovery, action: 'reload' };
    case 'ready':
      if (state.fellBack || state.readyAt !== null) return { state, action: 'none' };
      return { state: { ...state, readyAt: event.now }, action: 'none' };
    case 'timeout':
      // The map is already up, or the banner shows: a stale timer is not a failure.
      if (!event.loading) return { state, action: 'none' };
      return reduceRecovery(state, { type: 'failure', now: event.now });
    case 'failure': {
      if (state.fellBack) return { state, action: 'none' };
      const stable = state.readyAt !== null && event.now - state.readyAt >= STABLE_MS;
      const remounts = stable ? 0 : state.remounts;
      if (remounts >= MAX_AUTO_REMOUNTS) {
        return { state: { remounts, fellBack: true, readyAt: null }, action: 'fallback' };
      }
      return { state: { remounts: remounts + 1, fellBack: false, readyAt: null }, action: 'remount' };
    }
  }
}
