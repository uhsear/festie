// A series links editions of one recurring festival through festivals.series_id.
// The server accepts /^[a-z0-9-]{1,60}$/ (lib/schemas.ts festivalCreateSchema).

export interface SeriesFestival {
  id: string;
  name: string;
  seriesId?: string | null;
}

/** Mirrors the server's name-minus-year match (lib/notifications/reengagement.ts). */
const TRAILING_YEAR = /\s*(19|20)\d{2}\s*$/;

/** Lower-cases and replaces each run of characters outside [a-z0-9] with one hyphen. Keeps edge hyphens so typing "a-" works. */
export function slugifySeriesInput(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60);
}

/** "Forbidden Kingdom 2027" becomes "forbidden-kingdom". Empty when nothing usable is left. */
export function suggestSeriesId(name: string): string {
  return slugifySeriesInput(name.replace(TRAILING_YEAR, '')).replace(/^-+|-+$/g, '');
}

/** The distinct series ids in use, sorted, for the editor's picker. */
export function seriesIdsIn(festivals: readonly SeriesFestival[]): string[] {
  return [...new Set(festivals.map((f) => f.seriesId).filter((id): id is string => !!id))].sort();
}

/** The other festivals that share `seriesId`. */
export function otherEditions<T extends SeriesFestival>(
  festivals: readonly T[],
  seriesId: string | null | undefined,
  selfId: string | null | undefined,
): T[] {
  if (!seriesId) return [];
  return festivals.filter((f) => f.seriesId === seriesId && f.id !== selfId);
}

export interface SeriesBlock<F> {
  /** The series id when an edition carries one, else the slug of the name without its year. */
  key: string;
  /** The editions' shared name without the year, e.g. "Forbidden Kingdom". */
  label: string;
  /** Newest edition first. */
  editions: F[];
}

/**
 * Pulls the editions of one recurring festival out of a picker list. The public list hides `seriesId`
 * (it is admin only), so editions also match on the name without its trailing year, the rule the server
 * uses for re-engagement. A festival with no sibling stays standalone, so one-off festivals show as
 * before. Blocks keep the order of their first edition in `festivals`, standalone keeps list order.
 */
export function splitBySeries<F extends SeriesFestival & { startDate?: string | null }>(
  festivals: readonly F[],
): { series: SeriesBlock<F>[]; standalone: F[] } {
  const keyOf = (f: F) => f.seriesId || suggestSeriesId(f.name);
  const byKey = new Map<string, F[]>();
  for (const f of festivals) {
    const key = keyOf(f);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), f]);
  }
  const series: SeriesBlock<F>[] = [];
  const seen = new Set<string>();
  for (const f of festivals) {
    const key = keyOf(f);
    const editions = key ? byKey.get(key) : undefined;
    if (!editions || editions.length < 2 || seen.has(key)) continue;
    seen.add(key);
    const newestFirst = [...editions].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''));
    series.push({ key, label: f.name.replace(TRAILING_YEAR, '').trim() || f.name, editions: newestFirst });
  }
  const standalone = festivals.filter((f) => {
    const key = keyOf(f);
    return !key || (byKey.get(key)?.length ?? 0) < 2;
  });
  return { series, standalone };
}
