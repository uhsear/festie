import * as svgs from './svgs';

/** One illustration family (Open Peeps, CC0) for first-run empty states. */
export type IllustrationName = 'noPicks' | 'noCrew' | 'emptyList' | 'offline';

/** The single-ink SVG with every `currentColor` set to `color`. */
export function illustrationSvg(name: IllustrationName, color: string): string {
  return svgs[name].replaceAll('currentColor', color);
}

/** An `<img src>`-ready data URI. The web CSP already allows `data:` images. */
export function illustrationDataUri(name: IllustrationName, color: string): string {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(illustrationSvg(name, color));
}
