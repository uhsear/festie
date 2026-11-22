import { useSyncExternalStore } from 'react';

// How many password prompts are open. ConfirmDialog reads it so it can step aside instead of stacking.
let openPrompts = 0;
const listeners = new Set<() => void>();

export const trackReauthPrompt = (delta: number) => {
  openPrompts += delta;
  listeners.forEach((l) => l());
};

/** True while any password prompt from `useReauthPrompt` is open. */
export function useReauthPromptOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => openPrompts > 0,
  );
}
