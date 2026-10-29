import { ChevronUp, Play } from 'lucide-react';
import Button from '../ui/Button';

interface Props {
  preview: {
    embedUrl: string;
    embedType: string;
    label?: string;
    trackName?: string;
    artistName?: string;
  };
  visible: boolean;
  onToggle: () => void;
}

export default function DetailSpotifySection({ preview, visible, onToggle }: Props) {
  return (
    <div className="my-2.5">
      <Button
        variant="outline"
        size="sm"
        type="button"
        onClick={onToggle}
        aria-expanded={visible}
        icon={
          visible ? (
            <ChevronUp className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4" aria-hidden="true" />
          )
        }
      >
        {visible ? 'Hide Player' : 'Listen on Spotify'}
      </Button>
      {visible && (
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
    </div>
  );
}
