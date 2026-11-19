export interface OfflineQueueBridge {
  queueMutation: (args: unknown) => Promise<unknown>;
  processQueue: () => Promise<unknown>;
}

let bridge: OfflineQueueBridge | null = null;

/** The web app registers its IndexedDB-backed queue here; native never does. */
export function registerOfflineQueue(next: OfflineQueueBridge): () => void {
  bridge = next;
  return () => {
    if (bridge === next) bridge = null;
  };
}

export function getOfflineQueue(): OfflineQueueBridge | null {
  return bridge;
}
