import type { InvitePreview } from '../types/api';
import { formatFestivalDateRange } from './format';

const CODE_RE = /^[A-Z0-9]{4,12}$/;

/**
 * Extracts an invite code from a raw code or an invite link
 * (`festie.us/join/CODE`, `https://…/join/CODE`, `…?joinCrew=CODE`,
 * `festie://join/CODE`). Returns null when nothing valid is found.
 */
export function parseInviteCode(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  const fromQuery = /[?&]joinCrew=([^&#\s]+)/i.exec(text);
  const fromPath = /(?:^|[/:])join\/([^/?#\s]+)/i.exec(text);
  const raw = fromQuery?.[1] ?? fromPath?.[1] ?? text;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const code = decoded.toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

export function describeInvitePreview(p: InvitePreview): {
  title: string;
  stateLine: string;
  festivalLine: string | null;
  ownerLine: string | null;
} {
  const spots = p.spotsLeft === 0 ? 'full' : p.spotsLeft === 1 ? '1 spot left' : `${p.spotsLeft} spots left`;
  const dates = formatFestivalDateRange(p.startDate, p.endDate);
  const festivalParts = [p.festivalName, dates].filter((part): part is string => !!part);
  return {
    title: p.crewName,
    stateLine: `Crew of ${p.memberCount} · ${spots}`,
    festivalLine: festivalParts.length ? festivalParts.join(' · ') : null,
    ownerLine: p.ownerName ? `Started by ${p.ownerName}` : null,
  };
}

export function inviteShareMessage(crewName: string, url?: string): string {
  const text = `Join "${crewName}" on Festie`;
  return url ? `${text}: ${url}` : text;
}

// timeAgo only formats the past; invites expire in the future.
export function formatInviteExpiry(expiresAt: string | null | undefined, now = Date.now()): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(diff)) return null;
  if (diff <= 0) return 'Expired';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `Expires in ${Math.max(m, 1)}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `Expires in ${h}h` : `Expires in ${Math.floor(h / 24)}d`;
}

export type InviteStatus = 'loading' | 'ready' | 'invalid' | 'expired' | 'unreachable';

/** 404 is an unknown code, 410 an expired one; anything else (network, 5xx, 429) is unreachable. */
export function inviteErrorStatus(err: unknown): 'invalid' | 'expired' | 'unreachable' {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 404) return 'invalid';
  if (status === 410) return 'expired';
  return 'unreachable';
}

export function inviteStatusMessage(status: InviteStatus, signedIn: boolean): string | null {
  switch (status) {
    case 'invalid':
      return "We couldn't find a crew with this code. Check the link or ask for a new one.";
    case 'expired':
      return 'This invite has expired. Ask someone in the crew for a new link.';
    case 'unreachable':
      return signedIn
        ? "Can't check this invite right now. You can still join, and we'll finish when you're back online."
        : "Can't check this invite right now. Sign in or create an account, and we'll show it again.";
    default:
      return null;
  }
}
