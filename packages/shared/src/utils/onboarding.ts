import type { Festival } from '../types';
import { pickDefaultFestival, sortFestivalsForPicker } from './festivalTime';

export type IntroStepKey = 'plan' | 'crew' | 'reminders' | 'festival' | 'going';

const MAX_FESTIVAL_CHOICES = 5;

/** ['plan','crew','reminders','festival','going']; 'festival' is left out when festivalCount is 0. */
export function getIntroSteps(festivalCount: number): IntroStepKey[] {
  return festivalCount > 0
    ? ['plan', 'crew', 'reminders', 'festival', 'going']
    : ['plan', 'crew', 'reminders', 'going'];
}

/** The next step after `current`, or null when `current` is the last one or not in `steps`. */
export function nextIntroStep(steps: IntroStepKey[], current: IntroStepKey): IntroStepKey | null {
  const i = steps.indexOf(current);
  return i === -1 ? null : (steps[i + 1] ?? null);
}

/**
 * choices: sortFestivalsForPicker(festivals, now).slice(0, 5). When currentId names a festival
 * that is not in those five, it replaces the fifth.
 * defaultId: currentId when it names a festival in the list, else pickDefaultFestival(festivals, now)?.id, else null.
 */
export function introFestivalChoices<F extends Festival>(
  festivals: F[],
  currentId: string | null,
  now: Date = new Date(),
): { choices: F[]; defaultId: string | null } {
  const choices = sortFestivalsForPicker(festivals, now).slice(0, MAX_FESTIVAL_CHOICES);
  const current = currentId ? festivals.find((f) => f.id === currentId) : undefined;
  if (current && !choices.includes(current)) choices[MAX_FESTIVAL_CHOICES - 1] = current;
  const defaultId = current ? current.id : (pickDefaultFestival(festivals, now)?.id ?? null);
  return { choices, defaultId };
}

export type IntroCrewChoice = 'start' | 'join' | 'solo';

/** solo -> { start: null, needsAccount: false }. start -> 'create', join -> 'join'; needsAccount = !signedIn for both. */
export function introCrewAction(
  choice: IntroCrewChoice,
  signedIn: boolean,
): { start: 'create' | 'join' | null; needsAccount: boolean } {
  if (choice === 'solo') return { start: null, needsAccount: false };
  return { start: choice === 'start' ? 'create' : 'join', needsAccount: !signedIn };
}
