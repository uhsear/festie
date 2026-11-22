// mapLoadRecovery — decides what OfflineMap does when its WebView fails to come
// up. Framework-free so it can be unit-tested without mounting a WebView.
//
// The first WebView of a cold app can lose its renderer process (Android kills
// the sandboxed process, iOS terminates the content process) or stall past the
// load timeout. A fresh WebView almost always loads, so the first failure
// remounts once instead of showing "The map didn't load" at once.

/** Automatic remounts allowed before the banner and "Retry map" button show. */
export const MAX_AUTO_REMOUNTS = 1;

export type LoadFailureAction = 'remount' | 'fallback';

/** `remountsUsed` counts automatic remounts since the last manual retry. */
export function decideLoadFailure(remountsUsed: number): LoadFailureAction {
  return remountsUsed < MAX_AUTO_REMOUNTS ? 'remount' : 'fallback';
}
