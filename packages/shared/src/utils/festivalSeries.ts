// A series links editions of one recurring festival through festivals.series_id.
// The server accepts /^[a-z0-9-]{1,60}$/ (lib/schemas.ts festivalCreateSchema).

export interface SeriesFestival {
  id: string;
  name: string;
  seriesId?: string | null;
}

/** Mirrors the server's name-minus-year match (lib/notifications/reengagement.ts). */
const TRAILING_YEAR = /\s*(19|20)\d{2}\s*$/;

/** "Forbidden Kingdom 2027" becomes "forbidden-kingdom". Empty when nothing usable is left. */
export function suggestSeriesId(name: string): string {
  return name
    .replace(TRAILING_YEAR, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
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
