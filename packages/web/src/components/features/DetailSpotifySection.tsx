import { ChevronUp, Play } from 'lucide-react';
import type { SpotifyPreview, SpotifyPreviewStatus } from '@festie/shared/hooks';
import Button from '../ui/Button';

interface Props {
  status: SpotifyPreviewStatus;
  preview: (SpotifyPreview & { label?: string }) | null;
  spotifyUrl: string;
  visible: boolean;
  onToggle: () => void;
}

const linkClass =
  'inline-flex items-center min-h-11 text-[length:var(--font-size-14)] text-accent-aqua no-underline hover:underline';

export default function DetailSpotifySection({ status, preview, spotifyUrl, visible, onToggle }: Props) {
  const ready = status === 'ready';
  const open = ready && visible;
  return (
    <div className="my-2.5">
      {(ready || status === 'loading') && (
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={onToggle}
          disabled={!ready}
          aria-expanded={open}
          icon={
            open ? (
              <ChevronUp className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Play className="w-4 h-4" aria-hidden="true" />
            )
          }
        >
          {open ? 'Hide player' : 'Listen'}
        </Button>
      )}
      {status === 'offline' && <p className="text-sm text-text-secondary">Listening needs signal.</p>}
      {open && preview?.embedUrl && (
        <div className="my-2.5 rounded-xl overflow-hidden">
          <iframe
            src={preview.embedUrl}
            width="100%"
            height="152"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            title={`Spotify: ${preview.label || preview.trackName || preview.artistName || 'player'}`}
            className="block w-full rounded-xl"
          />
        </div>
      )}
      {(status === 'offline' || status === 'none' || open) && (
        <div>
          <a
            href={/^https?:/i.test(spotifyUrl) ? spotifyUrl : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Open in Spotify ↗
          </a>
        </div>
      )}
    </div>
  );
}
