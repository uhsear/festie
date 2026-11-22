/**
 * Plain-words label for a queued write, shared by web and mobile so the
 * PendingSyncSheet names a failed change the same way on both. Callers that
 * know better pass an explicit `offlineLabel`, which always wins over this.
 */

// Whole-phrase labels for endpoints where the generic "verb noun" reads wrong.
const FIXED_LABELS: Record<string, string> = {
  profiles: 'Update picks',
  join: 'Join crew',
  status: 'Update crew status',
  days: 'Update my days',
  caught: 'Update seen mark',
};

const NOUNS: Record<string, string> = {
  polls: 'poll',
  'meeting-points': 'meeting point',
  expenses: 'expense',
  members: 'member',
  picks: 'pick',
  notes: 'note',
  crews: 'crew',
  vote: 'vote',
  settle: 'settlement',
  'home-base': 'home base',
  rides: 'ride',
  packing: 'packing item',
  ratings: 'rating',
  reminders: 'reminder',
};

// The body field that names the thing, so two meeting points tell apart.
const DETAIL_FIELDS: Record<string, string> = {
  'meeting-points': 'label',
  polls: 'question',
  expenses: 'description',
};

export function describeMutation(method: string | undefined, url: string | undefined, body?: unknown): string {
  const m = (method || 'POST').toUpperCase();
  const path = (url || '').split('?')[0] || '';
  const verb = m === 'POST' ? 'Add' : m === 'PUT' || m === 'PATCH' ? 'Update' : m === 'DELETE' ? 'Remove' : m;

  // Trailing dynamic ids are skipped, so POST /crews/x/polls and
  // DELETE /crews/x/polls/y both read "... poll".
  const segments = path.split('/').filter(Boolean);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    const fixed = FIXED_LABELS[segment];
    if (fixed) return fixed;
    const noun = NOUNS[segment];
    if (!noun) continue;
    const field = DETAIL_FIELDS[segment];
    const detail = field && body && typeof body === 'object' ? (body as Record<string, unknown>)[field] : undefined;
    const name = typeof detail === 'string' ? detail.trim() : '';
    return name ? `${verb} ${noun}: ${name}` : `${verb} ${noun}`;
  }
  return `${m} ${path || '(unknown)'}`;
}
