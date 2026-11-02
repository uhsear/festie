import type { Festival, FestivalDay, FestivalSet, Stage } from '../types/domain';
import { artistDisplayName, formatFestivalDateRange, formatTime } from './format';
import { byStartTime } from './scheduleFormat';

/** "asir@example.com" -> "a@…e.com": first letter of the local part plus the last 5 characters of the domain. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return 'No email';
  const at = email.lastIndexOf('@');
  if (at < 1) return '…';
  return `${email[0]}@…${email.slice(at + 1).slice(-5)}`;
}

export interface ConfirmCopy {
  title: string;
  message: string;
  confirmLabel: string;
}

export function roleChangeCopy(username: string, grant: boolean): ConfirmCopy {
  return grant
    ? {
        title: `Grant admin to @${username}?`,
        message: `@${username} gets full control of every festival, user and crew, including deletes.`,
        confirmLabel: 'Grant admin',
      }
    : {
        title: `Revoke admin from @${username}?`,
        message: `@${username} loses access to the admin panel.`,
        confirmLabel: 'Revoke admin',
      };
}

export function resetLinkCopy(username: string): ConfirmCopy {
  return {
    title: `Create a reset link for @${username}?`,
    message: `Anyone who has this link can set a new password for @${username}. It works once. Send it only to the account owner.`,
    confirmLabel: 'Create link',
  };
}

export function resetLinkReadyMessage(username: string, expiresAt: string): string {
  const time = new Date(expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Send it only to @${username}. It stops working at ${time}.`;
}

export function removeMemberCopy(username: string, crewName: string): ConfirmCopy {
  return {
    title: `Remove @${username} from ${crewName}?`,
    message: "They stop seeing the crew's plan and live locations at once. They can rejoin with the invite code.",
    confirmLabel: 'Remove',
  };
}

export type BulkKind = 'force-logout' | 'archive';

export function bulkConfirmCopy(kind: BulkKind, n: number): ConfirmCopy {
  if (kind === 'force-logout') {
    return {
      title: `Force-logout ${n} ${n === 1 ? 'user' : 'users'}?`,
      message:
        'This signs them out on every device and ends their live connections. They can sign in again with the same password.',
      confirmLabel: 'Force-logout',
    };
  }
  return {
    title: `Archive ${n} ${n === 1 ? 'festival' : 'festivals'}?`,
    message: 'Attendees and crews lose access, and the festival leaves the festival picker.',
    confirmLabel: 'Archive',
  };
}

export function summarizeBulkResults(
  kind: BulkKind,
  results: ReadonlyArray<{ status: 'logged_out' | 'archived' | 'error' }>,
): string {
  const n = results.length;
  const ok = results.filter((r) => r.status === 'logged_out' || r.status === 'archived').length;
  const noun = kind === 'force-logout' ? 'user' : 'festival';
  const verb = kind === 'force-logout' ? 'Logged out' : 'Archived';
  const failed = n - ok;
  return `${verb} ${ok} of ${n} ${noun}${n === 1 ? '' : 's'}.${failed > 0 ? ` ${failed} failed.` : ''}`;
}

export const BULK_LIMIT = 50;
export const SELECTION_LIMIT_MESSAGE = 'You can select up to 50 at a time.';

export function toggleSelection(
  prev: ReadonlySet<string>,
  id: string,
  limit: number = BULK_LIMIT,
): { next: Set<string>; limited: boolean } {
  const next = new Set(prev);
  if (next.delete(id)) return { next, limited: false };
  if (next.size >= limit) return { next, limited: true };
  next.add(id);
  return { next, limited: false };
}

export function filterAdminCrews<
  T extends { name: string; creatorUsername?: string | null; festivalName?: string | null; inviteCode?: string | null },
>(crews: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return crews;
  return crews.filter((c) =>
    [c.name, c.creatorUsername, c.festivalName, c.inviteCode].some((v) => v?.toLowerCase().includes(q)),
  );
}

export const AUDIT_ACTION_FILTERS: ReadonlyArray<{ label: string; prefix: string }> = [
  { label: 'All', prefix: '' },
  { label: 'Roles', prefix: 'role_' },
  { label: 'Passwords', prefix: 'admin_reset_' },
  { label: 'Deleted users', prefix: 'admin_delete_user' },
  { label: 'Logouts', prefix: 'force_logout' },
  { label: 'Crews', prefix: 'crew_' },
  { label: 'Festivals', prefix: 'festival' },
  { label: 'Imports', prefix: 'lineup_import' },
  { label: 'Profile views', prefix: 'user.private_data' },
];

export const PRIVATE_VIEW_NOTICE = 'Opening this page is recorded in the audit log.';

export type FestivalPreviewInput = Festival & {
  stages: Stage[];
  days: Array<FestivalDay & { label?: string; sets?: FestivalSet[] }>;
};

export interface FestivalPreview {
  name: string;
  dateRange: string | null;
  location: string | undefined;
  days: Array<{
    key: string;
    label: string;
    date: string;
    sets: Array<{ id: string; time: string; artist: string; stageName: string; stageColor: string | undefined }>;
  }>;
  stages: Array<{ id: string; name: string; color: string | undefined; pinned: boolean }>;
  warnings: string[];
}

function previewTime(set: FestivalSet): string {
  if (!set.startTime) return 'Time TBA';
  const start = formatTime(set.startTime);
  return set.endTime ? `${start} – ${formatTime(set.endTime)}` : start;
}

export function buildFestivalPreview(detail: FestivalPreviewInput): FestivalPreview {
  const stageById = new Map(detail.stages.map((s) => [s.id, s]));
  const days = detail.days.map((day, i) => ({
    // GET /festivals/:id days carry no id; dayIndex is unique per festival.
    key: String(day.dayIndex ?? i),
    label: day.label || `Day ${i + 1}`,
    date: day.date,
    sets: [...(day.sets ?? [])].sort(byStartTime).map((set) => {
      const stage = stageById.get(set.stageId);
      return {
        id: set.id,
        time: previewTime(set),
        artist: artistDisplayName(set, detail.b2bSeparator),
        stageName: stage?.name ?? set.stageName ?? '',
        stageColor: stage?.color,
      };
    }),
  }));
  const stages = detail.stages.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    pinned: typeof s.latitude === 'number' && typeof s.longitude === 'number',
  }));

  const warnings: string[] = [];
  const unpinned = stages.filter((s) => !s.pinned);
  if (unpinned.length > 0) {
    const n = unpinned.length;
    warnings.push(`${n} ${n === 1 ? 'stage has' : 'stages have'} no map pin: ${unpinned.map((s) => s.name).join(', ')}.`);
  }
  const untimed = detail.days.flatMap((d) => d.sets ?? []).filter((s) => !s.startTime).length;
  if (untimed > 0) warnings.push(`${untimed} ${untimed === 1 ? 'set has' : 'sets have'} no start time.`);
  for (const day of days) if (day.sets.length === 0) warnings.push(`${day.label} has no sets.`);

  return {
    name: detail.name,
    dateRange: formatFestivalDateRange(detail.startDate, detail.endDate),
    location: detail.location,
    days,
    stages,
    warnings,
  };
}
