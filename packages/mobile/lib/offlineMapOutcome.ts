// The last map-download attempt per archive URL, kept outside React. The Picks screen unmounts the
// offline card while the download reloads the festival, so state held in the card's own hook was lost
// and the step fell back to "not saved" with no message. No expo imports, so it is testable alone.
import type { SectionReadiness } from '@festie/shared/stores';

export interface MapOutcome {
  section: SectionReadiness;
  message: string | null;
}

const outcomes = new Map<string, MapOutcome>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((cb) => cb());

export const getMapOutcome = (url: string | null | undefined): MapOutcome | null =>
  (url && outcomes.get(url)) || null;

export function setMapOutcome(url: string, outcome: MapOutcome | null): void {
  if (outcome) outcomes.set(url, outcome);
  else outcomes.delete(url);
  notify();
}

export function subscribeMapOutcome(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
