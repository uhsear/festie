import type { Artist, FestivalSet } from '@festie/shared/types';
import ArtistName from './ArtistName';

interface Props {
  artistName: string;
  subtitle: string | null;
  primaryArtist: Artist | undefined;
  stageColor: string;
  /** Original set.artist for alt text fallback */
  setArtist: string | undefined;
  /** When given, the name renders as buttons that open the artist sheet, one per artist of a B2B set. */
  set?: FestivalSet;
  separator?: string;
}

export default function DetailArtistHeader({ artistName, subtitle, primaryArtist, stageColor, setArtist, set, separator }: Props) {
  return (
    <div className="flex items-center gap-3 my-2">
      {primaryArtist && primaryArtist.photo && (
        <div className="flex-shrink-0 rounded-full" style={{ background: stageColor + '18' }}>
          <img
            src={primaryArtist.photo}
            alt={primaryArtist.name || setArtist || ''}
            className="w-14 h-14 rounded-full object-cover img-outline block"
            width={300}
            height={300}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const wrap = (e.target as HTMLElement).parentElement;
              if (wrap) wrap.remove();
            }}
          />
        </div>
      )}
      <div className="min-w-0">
        <div className="type-heading text-text-primary" id="detail-panel-title">
          {set ? <ArtistName set={set} separator={separator} /> : artistName}
        </div>
        {subtitle && (
          <div className="text-[length:var(--font-size-14)] font-medium leading-[1.35] text-text-muted mt-1 overflow-hidden text-ellipsis [-webkit-line-clamp:4] [-webkit-box-orient:vertical] [display:-webkit-box] break-words">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
