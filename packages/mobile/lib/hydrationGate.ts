/** The slice of a zustand `persist` API the boot gate needs. */
export interface PersistLike {
  hasHydrated(): boolean;
  onFinishHydration(listener: () => void): () => void;
}

/**
 * Runs `onDone` once the persisted store has rehydrated: immediately if it
 * already has, otherwise when hydration finishes. Returns an unsubscribe.
 * Checking before subscribing closes the gap between a render-time
 * `hasHydrated()` read and the effect that subscribes.
 */
export function onHydrated(persist: PersistLike, onDone: () => void): () => void {
  if (persist.hasHydrated()) {
    onDone();
    return () => {};
  }
  return persist.onFinishHydration(onDone);
}
