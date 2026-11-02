export interface AdminTarget {
  kind: 'festival' | 'crew' | 'user';
  id: string;
  label: string;
  hint: string;
}

export interface AdminSearchData {
  festivals: Array<{ id: string; name: string; location?: string | null }>;
  crews: Array<{ id: string; name: string; inviteCode?: string | null; festivalName?: string | null }>;
}

const PREFIX_KINDS = { f: 'festival', u: 'user', c: 'crew' } as const;

export function searchAdminTargets(query: string, data: AdminSearchData, limit = 5): AdminTarget[] {
  let q = query.trim();
  if (!q) return [];
  let only: AdminTarget['kind'] | null = null;
  const prefix = /^([fuc])\s+(.*)$/i.exec(q);
  if (prefix) {
    only = PREFIX_KINDS[(prefix[1] ?? '').toLowerCase() as keyof typeof PREFIX_KINDS];
    q = (prefix[2] ?? '').trim();
    if (!q) return [];
  }
  const needle = q.toLowerCase();
  const has = (s?: string | null): boolean => !!s && s.toLowerCase().includes(needle);
  const out: AdminTarget[] = [];

  if (!only || only === 'festival') {
    data.festivals
      .filter((f) => has(f.name) || has(f.location))
      .slice(0, limit)
      .forEach((f) => out.push({ kind: 'festival', id: f.id, label: f.name, hint: f.location ?? '' }));
  }
  if (!only || only === 'crew') {
    const exact = data.crews.filter((c) => c.inviteCode && c.inviteCode.toLowerCase() === needle);
    const rest = data.crews.filter((c) => !exact.includes(c) && has(c.name));
    const crews: AdminTarget[] = [
      ...exact.map((c) => ({
        kind: 'crew' as const,
        id: c.id,
        label: c.name,
        hint: `Invite code ${c.inviteCode} · ${c.festivalName ?? ''}`,
      })),
      ...rest.map((c) => ({ kind: 'crew' as const, id: c.id, label: c.name, hint: c.festivalName ?? '' })),
    ];
    out.push(...crews.slice(0, limit));
  }
  if (!only || only === 'user') {
    out.push({ kind: 'user', id: q, label: `Search users for "${q}"`, hint: 'Opens the user list' });
  }
  return out;
}
