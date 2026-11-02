import React from 'react';

const PLATFORM_LABELS: Record<string, string> = {
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
  instagram: 'Instagram',
  twitter: 'X',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  website: 'Website',
};

interface Props {
  artistLinks: Array<{ name: string; links: Record<string, string> }>;
  isB2B: boolean;
  genres: string[];
  /** The Spotify link the Listen section already owns; hidden here. */
  hideLink?: { name: string; url: string } | null;
}

export default function DetailArtistLinks({ artistLinks, isB2B, genres, hideLink }: Props) {
  return (
    <>
      {/* Genre chips */}
      {genres.length > 0 && (
        <div className="flex flex-wrap gap-1.5 my-1.5 mb-2.5">
          {genres.map((g) => (
            <span
              key={g}
              className="px-2.5 py-0.5 rounded-DEFAULT bg-[var(--color-overlay-2)] border border-border text-text-secondary text-[length:var(--font-size-12)] font-semibold capitalize tracking-[0.02em]"
            >
              {g}
            </span>
          ))}
        </div>
      )}

      {/* Artist links */}
      {artistLinks.length > 0 && (
        <div>
          {artistLinks.map((a, i) => (
            <React.Fragment key={a.name + i}>
              {isB2B && <div className="mt-1.5 text-xs font-semibold text-text-secondary">{a.name}</div>}
              <div className="py-1 pb-2 text-[length:var(--font-size-14)] flex flex-wrap gap-2.5">
                {Object.entries(a.links || {})
                  .filter(([platform, url]) => !(platform === 'spotify' && hideLink && url === hideLink.url))
                  .map(([platform, url]) => (
                    <a
                      key={platform}
                      // Defense-in-depth: React passes javascript:/data: URLs
                      // through to the DOM, so only emit an href for http(s).
                      href={/^https?:/i.test(url) ? url : undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center min-h-11 text-[length:var(--font-size-14)] text-accent-aqua no-underline hover:underline"
                    >
                      {(PLATFORM_LABELS[platform] || platform) + ' ↗'}
                    </a>
                  ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  );
}
