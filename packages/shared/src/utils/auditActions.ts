/**
 * Audit action labels, change descriptions, qualifier search and CSV export.
 * Pure TypeScript with no React or DOM imports: the backend test imports this file by path.
 * Mirrors lib/audit-actions.ts, which holds the dotted action names.
 */

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'festival.created': 'Festival created',
  'festival.updated': 'Festival updated',
  'festival.deleted': 'Festival deleted',
  'festival.purged': 'Festival deleted permanently',
  'festival.archived': 'Festival archived',
  'festival.published': 'Festival published',
  'festival.restored': 'Festival restored',
  'festival.siteplan.uploaded': 'Site plan uploaded',
  'festival.announcement.sent': 'Announcement sent',
  'festival.announcement.cancelled': 'Announcement cancelled',
  'festival.lineup.imported': 'Lineup imported',
  'festival.lineup.import_undone': 'Lineup import undone',
  'festival.lineup.announced': 'Lineup announcement sent',
  'festival.spotify.backfilled': 'Spotify links filled in',
  'set.link.updated': 'Set link changed',
  'user.role.granted': 'Role granted',
  'user.role.revoked': 'Role removed',
  'user.password_reset_link.created': 'Password reset link created',
  'user.password.reset': 'Password reset by an admin',
  'user.deleted': 'User deleted',
  'user.sessions.revoked': 'Signed out everywhere',
  'user.private_data.viewed': 'User details viewed',
  'crew.member.added': 'Crew member added',
  'crew.member.removed': 'Crew member removed',
  'crew.deleted': 'Crew deleted',
};

const COLON_VERBS: Record<string, string> = {
  create: 'created',
  replace: 'replaced',
  update: 'updated',
  delete: 'deleted',
};

const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const spaced = (s: string): string => s.replace(/[-_]/g, ' ');

export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTION_LABELS[action];
  if (known) return known;
  const dotted = /^([^.:]+)\.(created|replaced|updated|deleted)$/.exec(action);
  if (dotted) return `${upperFirst(spaced(dotted[1] ?? ''))} ${dotted[2]}`;
  const colon = /^([a-z]+):([^.:]+)$/i.exec(action);
  const verb = colon ? COLON_VERBS[(colon[1] ?? '').toLowerCase()] : undefined;
  if (colon && verb) return `${upperFirst(spaced(colon[2] ?? ''))} ${verb}`;
  return upperFirst(action.replace(/[._:]/g, ' '));
}

export interface AuditChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

const CHANGE_LABELS: Record<string, string> = {
  name: 'Name',
  location: 'Location',
  timeZone: 'Time zone',
  b2bSeparator: 'B2B separator',
  stages: 'Stages',
  days: 'Days',
  sets: 'Sets',
  roles: 'Roles',
};

function changeValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(none)';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '(none)';
  return String(v);
}

export function describeAuditChanges(details: Record<string, unknown> | null | undefined): AuditChange[] {
  const changes = details?.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return [];
  return Object.entries(changes as Record<string, unknown>).map(([field, pair]) => {
    const [before, after] = Array.isArray(pair) ? pair : [null, null];
    return { field, label: CHANGE_LABELS[field] ?? field, before: changeValue(before), after: changeValue(after) };
  });
}

export type AuditQueryKey = 'actor' | 'user' | 'action' | 'after' | 'before';

export interface AuditQueryFilters {
  actor?: string;
  user?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface AuditQueryToken {
  key: AuditQueryKey;
  value: string;
  raw: string;
}

export interface ParsedAuditQuery {
  filters: AuditQueryFilters;
  tokens: AuditQueryToken[];
  errors: string[];
}

const QUERY_KEYS: readonly string[] = ['actor', 'user', 'action', 'after', 'before'];

function dayBound(value: string, endOfDay: boolean): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d.toISOString();
}

export function parseAuditQuery(text: string): ParsedAuditQuery {
  const filters: AuditQueryFilters = {};
  const tokens: AuditQueryToken[] = [];
  const errors: string[] = [];
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const colon = raw.indexOf(':');
    const key = colon > 0 ? raw.slice(0, colon).toLowerCase() : '';
    const value = colon > 0 ? raw.slice(colon + 1) : '';
    if (!QUERY_KEYS.includes(key) || !value) {
      errors.push(`Unknown filter "${raw}". Use actor:, user:, action:, after: or before:.`);
      continue;
    }
    if (key === 'after' || key === 'before') {
      const bound = dayBound(value, key === 'before');
      if (!bound) {
        errors.push(`"${raw}" is not a date. Use YYYY-MM-DD.`);
        continue;
      }
      filters[key === 'after' ? 'from' : 'to'] = bound;
    } else {
      filters[key as 'actor' | 'user' | 'action'] = value;
    }
    tokens.push({ key: key as AuditQueryKey, value, raw });
  }
  return { filters, tokens, errors };
}

export function removeAuditQueryToken(text: string, raw: string): string {
  return text
    .split(/\s+/)
    .filter((t) => t && t !== raw)
    .join(' ');
}

// Swaps the query's action: token for `action:<prefix>`; an empty prefix only removes it.
export function setAuditQueryAction(text: string, prefix: string): string {
  const rest = text.split(/\s+/).filter((t) => t && !/^action:/i.test(t));
  return [...rest, ...(prefix ? [`action:${prefix}`] : [])].join(' ');
}

export interface AuditCsvEntry {
  action: string;
  actorUsername?: string | null;
  targetLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown> | null;
  status?: string | null;
  createdAt: string;
  requestId?: string | null;
}

export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

const CSV_HEADER = [
  'Time (UTC)',
  'Action',
  'Description',
  'By',
  'Affects',
  'Target type',
  'Target ID',
  'Status',
  'Changes',
  'Request ID',
];

export function auditEntriesToCsv(entries: AuditCsvEntry[]): string {
  const rows = entries.map((e) =>
    [
      e.createdAt,
      e.action,
      auditActionLabel(e.action),
      e.actorUsername || 'System',
      e.targetLabel ?? '',
      e.targetType ?? '',
      e.targetId ?? '',
      e.status ?? '',
      describeAuditChanges(e.details)
        .map((c) => `${c.label}: ${c.before} to ${c.after}`)
        .join('; '),
      e.requestId ?? '',
    ].map(csvCell),
  );
  return [CSV_HEADER.map(csvCell), ...rows].map((r) => r.join(',')).join('\r\n');
}
