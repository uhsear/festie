import type { FestivalPhase } from './festivalTime';
import { COPY } from '../constants/copy';

export type HomeActionKey = 'first-pick' | 'crew' | 'find' | 'wrap' | 'settle';
export interface HomeAction {
  key: HomeActionKey;
  kind: 'link' | 'hint';
  label: string;
  a11y: string;
}

const CREW: HomeAction = { key: 'crew', kind: 'link', label: 'Start or join a crew', a11y: 'Start or join a crew' };

/** The next useful steps for the schedule band. Empty when there is nothing to do. */
export function getHomeActions(input: {
  phase: FestivalPhase | null;
  signedIn: boolean;
  pickCount: number;
  hasCrew: boolean;
}): HomeAction[] {
  const { phase, signedIn, pickCount, hasCrew } = input;
  if (!signedIn || !phase) return [];
  const actions: HomeAction[] = [];
  if (phase === 'pre') {
    if (pickCount === 0) {
      actions.push({
        key: 'first-pick',
        kind: 'hint',
        label: 'Pick your first sets below',
        a11y: 'Pick your first sets below',
      });
    }
    if (!hasCrew) actions.push(CREW);
  } else if (phase === 'live') {
    actions.push(
      hasCrew ? { key: 'find', kind: 'link', label: COPY.find.action, a11y: 'Find your crew on the map' } : CREW,
    );
  } else {
    actions.push({ key: 'wrap', kind: 'link', label: COPY.wrap.open, a11y: `Open your ${COPY.wrap.name}` });
    if (hasCrew) {
      actions.push({ key: 'settle', kind: 'link', label: 'Settle up with your crew', a11y: 'Settle up crew expenses' });
    }
  }
  return actions;
}
