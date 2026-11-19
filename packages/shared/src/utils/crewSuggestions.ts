/**
 * Pure phrasing for crew suggestions, shared so web and mobile cannot drift.
 * The nudge logic itself is in crewNudges (buildCrewNudges / useCrewNudges);
 * these only phrase what it returns.
 */

/** Count caption: "3 going — 2 must, 1 want". */
export function goingLabel(count: number, breakdown: string): string {
  return `${count} going${breakdown ? ` — ${breakdown}` : ''}`;
}

/** Add a11y label: "Add Foo to my picks — 3 crew going: 2 must, 1 want". */
export function addLabel(name: string, count: number, breakdown: string): string {
  return `Add ${name} to my picks${breakdown ? ` — ${count} crew going: ${breakdown}` : ''}`;
}

/** Avatar-cluster a11y label (CrewOverlapAvatars): "3 crew members going to Foo — 2 must, 1 want". */
export function clusterLabel(name: string, count: number, breakdown: string): string {
  return `${count} crew ${count === 1 ? 'member' : 'members'} going to ${name}${breakdown ? ` — ${breakdown}` : ''}`;
}

/** Conflict-card crew line: "3 crew going — 2 must, 1 want". */
export function crewGoingLabel(count: number, breakdown: string): string {
  return `${count} crew going${breakdown ? ` — ${breakdown}` : ''}`;
}
