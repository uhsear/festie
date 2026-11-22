type JoinSelectInput = {
  joinedParam: string | undefined;
  crewLoading: boolean;
  activeCrewId: string | null | undefined;
  crewIds: string[];
  selected: string | null;
};

// Decides whether the join landing should switch to the joined crew. It only switches away from a crew
// that is actually active: with no active crew, useActiveCrew's auto-select (and its retry) owns the choice.
export function nextJoinSelect(i: JoinSelectInput): { select: string | null; selected: string | null } {
  if (!i.joinedParam) return { select: null, selected: null };
  if (i.crewLoading || !i.activeCrewId || i.activeCrewId === i.joinedParam) return { select: null, selected: i.selected };
  if (i.selected === i.joinedParam || !i.crewIds.includes(i.joinedParam)) return { select: null, selected: i.selected };
  return { select: i.joinedParam, selected: i.joinedParam }; // once per join, so a failed select cannot loop
}
