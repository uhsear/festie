import { Artist } from '@festie/shared/types';

interface Props {
  artistName: string;
  subtitle: string | null;
  primaryArtist: Artist | undefined;
  stageColor: string;
  /** Original set.artist for alt text fallback */
  setArtist: string | undefined;
}

export default function DetailArtistHeader({ artistName, subtitle, primaryArtist, stageColor, setArtist }: Props) {
  return (
    <div className="flex items-center gap-3 my-2">
      {primaryArtist && primaryArtist.photo && (
        <div className="flex-shrink-0 rounded-full" style={{ background: stageColor + '18' }}>
          <img
            src={primaryArtist.photo}
            alt={primaryArtist.name || setArtist || ''}
            className="w-14 h-14 rounded-full object-cover border-2 border-[var(--color-overlay-5)] block"
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
          {artistName}
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
