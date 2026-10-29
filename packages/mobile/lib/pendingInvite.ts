import { api } from '@festie/shared/services';

export interface InvitePreview {
  crewName: string;
  ownerName: string | null;
  memberCount: number;
  expiresAt: string | null;
}

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

/** GET /crews/join-preview/:code (public). Rejects for an unknown or expired code. */
export function fetchInvitePreview(code: string): Promise<InvitePreview> {
  return api.get<InvitePreview>(`/crews/join-preview/${encodeURIComponent(code)}`);
}

export function describeInvite(p: InvitePreview): { title: string; detail: string } {
  const members = `${p.memberCount} ${p.memberCount === 1 ? 'member' : 'members'} so far`;
  const expiry = p.expiresAt
    ? ` Valid until ${new Date(p.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`
    : '';
  return {
    title: p.crewName,
    detail: `${p.ownerName ? `${p.ownerName} invited you. ` : ''}${members}.${expiry}`,
  };
}
