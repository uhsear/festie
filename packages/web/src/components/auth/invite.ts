/** Where useFestivalLoader stashes a ?joinCrew= code for a visitor who is not signed in. */
export const PENDING_JOIN_KEY = 'fk.pendingJoinCrew';

/** Invite code carried by the current visit: a staged code, else a live ?joinCrew= param. */
export function readPendingInviteCode(): string | null {
  let code: string | null = null;
  try {
    code = sessionStorage.getItem(PENDING_JOIN_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
  code ??= new URLSearchParams(window.location.search).get('joinCrew');
  return code && /^[a-zA-Z0-9]{4,12}$/.test(code) ? code : null;
}
