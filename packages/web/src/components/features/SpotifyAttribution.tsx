import { SPOTIFY_HOME_URL, SPOTIFY_LISTEN_LABEL, SPOTIFY_MIN_LOGO_WIDTH_PX, isSafeExternalUrl } from '@festie/shared/utils';
import { cn } from '@/lib/utils';

interface Props {
  /** The artist's Spotify page. Anything that is not an http(s) link falls back to Spotify's home page. */
  href: string;
  className?: string;
}

// The official Spotify full logo (icon and wordmark), unmodified, from developer.spotify.com/documentation/design.
// White on the dark theme, black on the daylight theme (.spotify-logo-* in styles/components.css).
const LOGO_WIDTH = Math.max(SPOTIFY_MIN_LOGO_WIDTH_PX, 80);
const LOGO_HEIGHT = Math.round((LOGO_WIDTH * 225.25) / 823.46);

/**
 * "Listen on Spotify" with the Spotify logo, linking to the artist's Spotify page. Shown wherever Spotify
 * photos or genres show (Spotify Developer Policy II.4; see @festie/shared spotifyAttribution). Never sits
 * on top of artwork.
 */
export default function SpotifyAttribution({ href, className }: Props) {
  return (
    <a
      href={isSafeExternalUrl(href) ? href : SPOTIFY_HOME_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="spotify-attribution"
      aria-label={SPOTIFY_LISTEN_LABEL}
      className={cn(
        'inline-flex items-center gap-2 min-h-11 text-[length:var(--font-size-12)] font-semibold uppercase tracking-[0.04em] text-text-secondary no-underline hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
        className,
      )}
    >
      <span aria-hidden="true">{SPOTIFY_LISTEN_LABEL.replace(/ Spotify$/, '')}</span>
      <img className="spotify-logo-on-dark" src="/spotify/Full_Logo_White_RGB.svg" alt="" width={LOGO_WIDTH} height={LOGO_HEIGHT} />
      <img className="spotify-logo-on-light" src="/spotify/Full_Logo_Black_RGB.svg" alt="" width={LOGO_WIDTH} height={LOGO_HEIGHT} />
    </a>
  );
}
