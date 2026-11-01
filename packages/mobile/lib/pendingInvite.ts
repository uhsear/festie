const CODE_SHAPE = /^[a-zA-Z0-9]{4,12}$/;

// In-memory on purpose: it only has to survive the hop from the invite screen
// through sign-in or sign-up, and a cold start should not replay a stale invite.
let pendingCode: string | null = null;

export function isValidInviteCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_SHAPE.test(code);
}

export function setPendingInvite(code: string | null): void {
  pendingCode = isValidInviteCode(code) ? code : null;
}

export function getPendingInvite(): string | null {
  return pendingCode;
}

/** An invite link or a pending invite means the user came to join a crew, so the intro slides only get in the way. */
export function shouldSkipIntro(firstSegment: string | undefined): boolean {
  return firstSegment === 'join' || getPendingInvite() !== null;
}
