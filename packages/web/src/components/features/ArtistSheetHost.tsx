import { useMemo } from 'react';
import { useFestivalStore } from '@festie/shared/stores';
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';
import { useInterest } from '@festie/shared/hooks/useInterest';
import { artistLinkEntries, spotifyAttributionFor } from '@festie/shared/utils';
import { enrichArtistTarget } from '@festie/shared/utils/artistSheet';
import { genreChipLabel } from '@festie/shared/constants';
import Avatar from '../ui/Avatar';
import Sheet from '../ui/Sheet';
import SpotifyAttribution from './SpotifyAttribution';
import { cn } from '../../lib/utils';

export const sheetButtonClass =
  'rounded-full px-3 min-h-11 text-[length:var(--font-size-14)] font-semibold cursor-pointer ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua ';

/** The filled or empty "Interested" toggle on one act. A guest's mark stays on the device. */
export function InterestToggle({ entryId, name, onMarked }: { entryId: string; name: string; onMarked?: () => void }) {
  const { marked, toggle } = useInterest(entryId);
  return (
    <button
      type="button"
      aria-pressed={marked}
      aria-label={`Interested in ${name}`}
      onClick={() => {
        if (!marked) onMarked?.();
        // toggleInterest rolls the mark back and sets the store error when the write fails, so the toggle already shows the truth.
        toggle().catch(() => {});
      }}
      className={cn(
        'rounded-full border px-3 min-h-11 text-xs font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
        marked ? 'border-accent-aqua bg-accent-aqua text-[var(--text-on-light-accent)]' : 'border-border text-text-secondary hover:text-text-primary',
      )}
    >
      Interested
    </button>
  );
}

/**
 * The one artist sheet: each artist's photo, genres and links, plus the Interested toggle for an announced
 * act. Mounted once in AppShell. Every artist name in the app opens it through useArtistSheetStore.
 */
export default function ArtistSheetHost() {
  const target = useArtistSheetStore((s) => s.target);
  const isOpen = useArtistSheetStore((s) => s.isOpen);
  const close = useArtistSheetStore((s) => s.close);
  const sets = useFestivalStore((s) => s.sets);
  const shown = useMemo(() => (target ? enrichArtistTarget(target, sets ?? []) : null), [target, sets]);
  return (
    <Sheet open={isOpen} onOpenChange={(next) => !next && close()} title={shown?.title ?? ''}>
      {shown && (
        <div className="flex flex-col gap-4">
          {shown.artists.map((artist, i) => (
            <div key={artist.id ?? `${artist.name}-${i}`} className="flex items-start gap-3">
              <Avatar name={artist.name} image={artist.photo} size="lg" />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-base font-semibold text-text-primary">{artist.name}</span>
                {artist.genres && artist.genres.length > 0 && (
                  <span className="text-sm text-text-secondary">{artist.genres.map(genreChipLabel).join(' · ')}</span>
                )}
                {spotifyAttributionFor([artist]) ? <SpotifyAttribution href={spotifyAttributionFor([artist])!.href} /> : null}
                <div className="flex flex-wrap gap-2">
                  {artistLinkEntries(artist.links).map((link) => (
                    <a
                      key={link.key}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`${artist.name} on ${link.label}`}
                      className={cn(sheetButtonClass, 'inline-flex items-center border border-border text-text-primary')}
                    >
                      {link.label + ' ↗'}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
          {shown.entryId && (
            <div>
              <InterestToggle entryId={shown.entryId} name={shown.title} />
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
