import { INBOX_COPY } from './inboxCopy';
import { PRIORITY_OPTIONS } from './config';

/** The empty states that show a product-shaped ghost row instead of an illustration. */
export type GhostRowKind = 'picks' | 'crew' | 'inbox';

/** A colour token path inside the shared palettes (`colors` and `colorsDaylight`). */
export type GhostTokenPath = 'border.light' | 'text.secondary' | 'text.muted' | 'accent.aqua';

export interface GhostRow {
  /** Each app maps the glyph to its own icon set: Lucide on web, Ionicons on mobile. */
  glyph: 'music' | 'person' | 'bell';
  /** Real product labels, shown in the row's text. */
  title: string;
  detail: string;
  /** Pill labels at the row's end, in order. */
  pills: readonly string[];
  /** Token names for the dashed hairline, the text and the glyph. Apps resolve them per theme. */
  tokens: { border: GhostTokenPath; text: GhostTokenPath; glyph: GhostTokenPath };
}

const tokens = { border: 'border.light', text: 'text.secondary', glyph: 'text.muted' } as const;

/** The row model for each ghost-row empty state. Labels come from the same copy the live rows use. */
export const GHOST_ROWS: Record<GhostRowKind, GhostRow> = {
  // A set card with the three pick choices a real card offers.
  picks: {
    glyph: 'music',
    title: 'Artist name',
    detail: 'Stage · 9:00 PM',
    pills: PRIORITY_OPTIONS.map((p) => p.short),
    tokens,
  },
  // A crew member row, as the Members tab lists one.
  crew: { glyph: 'person', title: 'Your friend', detail: 'Picks and plans in one place', pills: ['Member'], tokens },
  // A quiet notification row, as the inbox lists one. No pills: nothing has arrived.
  inbox: { glyph: 'bell', title: INBOX_COPY.bellLabel, detail: 'Set reminders and crew news', pills: [], tokens },
};

/** Read a token path such as `text.secondary` from a palette. */
export function resolveGhostToken(palette: object, path: GhostTokenPath): string {
  const [group, key] = path.split('.') as [string, string];
  const value = (palette as Record<string, Record<string, string> | undefined>)[group]?.[key];
  if (!value) throw new Error(`Unknown colour token "${path}". Add it to the shared palettes.`);
  return value;
}
