import { Bell, Music, User, type LucideIcon } from 'lucide-react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { GHOST_ROWS, resolveGhostToken, type GhostRow as GhostRowModel, type GhostRowKind } from '@festie/shared/constants/ghostRows';
import { colors, colorsDaylight } from '@festie/shared/tokens';

const GLYPH: Record<GhostRowModel['glyph'], LucideIcon> = { music: Music, person: User, bell: Bell };

/** A dashed, decorative example row for an empty state. The row model lives in `@festie/shared`. */
export default function GhostRow({ kind }: { kind: GhostRowKind }) {
  const row = GHOST_ROWS[kind];
  // Read the tokens, not the DOM: data-theme is applied in a later effect.
  const palette = useUIStore((s) => s.theme) === 'daylight' ? colorsDaylight : colors;
  const token = (path: Parameters<typeof resolveGhostToken>[1]) => resolveGhostToken(palette, path);
  const Glyph = GLYPH[row.glyph];
  return (
    <div
      aria-hidden="true"
      data-testid="ghost-row"
      className="flex w-full max-w-[320px] items-center gap-3 rounded-lg border border-dashed px-3 py-3 text-left"
      style={{ borderColor: token(row.tokens.border), color: token(row.tokens.text) }}
    >
      <Glyph className="h-5 w-5 shrink-0" style={{ color: token(row.tokens.glyph) }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.title}</div>
        <div className="truncate text-xs">{row.detail}</div>
      </div>
      {row.pills.map((label) => (
        <span key={label} className="shrink-0 rounded-full border border-dashed px-2 py-0.5 text-xs" style={{ borderColor: token(row.tokens.border) }}>
          {label}
        </span>
      ))}
    </div>
  );
}
