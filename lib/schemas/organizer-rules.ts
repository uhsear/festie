// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { normalizeArtistLink, type ArtistLinkPlatform } from '../artist-links';

/**
 * What an organization member may point a festival at (plan-v3 6.3). The festival schemas accept any https
 * link, which is right for an admin. A member's body also passes these rules:
 * - an artist link must be a profile on its platform, judged by lib/artist-links.ts, and https;
 * - the offline basemap and the site-plan image must be files Festie hosts under /uploads/.
 * An admin's save never runs them. Run the schema on the body after the festival schema has validated it.
 */
export function organizerFestivalRules(origin: string) {
  const hostOrigin = new URL(origin).origin;
  const hostedUnder = (url: string, directory: string) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === hostOrigin && parsed.pathname.startsWith(`/uploads/${directory}/`);
    } catch {
      return false;
    }
  };

  return z
    .object({})
    .passthrough()
    .superRefine((body: any, ctx) => {
      const issue = (path: Array<string | number>, message: string) => ctx.addIssue({ code: 'custom', path, message });

      const checkLinks = (links: Record<string, unknown> | undefined, path: Array<string | number>) => {
        for (const [platform, url] of Object.entries(links ?? {})) {
          if (typeof url !== 'string' || url === '') continue;
          const at = [...path, 'links', platform];
          if (!/^https:\/\//i.test(url.trim())) {
            issue(at, 'Use an https link.');
            continue;
          }
          const result = normalizeArtistLink(platform as ArtistLinkPlatform, url);
          if (!result.ok) issue(at, result.message);
        }
      };

      (body.days ?? []).forEach((day: any, dayIndex: number) =>
        (day?.sets ?? []).forEach((set: any, setIndex: number) =>
          (set?.artists ?? []).forEach((artist: any, artistIndex: number) =>
            checkLinks(artist?.links, ['days', dayIndex, 'sets', setIndex, 'artists', artistIndex]),
          ),
        ),
      );
      (body.lineup ?? []).forEach((entry: any, entryIndex: number) =>
        (entry?.artists ?? []).forEach((artist: any, artistIndex: number) =>
          checkLinks(artist?.links, ['lineup', entryIndex, 'artists', artistIndex]),
        ),
      );

      const basemap = body.mapConfig?.offlineBasemap?.pmtilesUrl;
      if (typeof basemap === 'string' && !hostedUnder(basemap, 'basemaps')) {
        issue(['mapConfig', 'offlineBasemap', 'pmtilesUrl'], 'The offline map must be a file hosted by Festie. Ask Festie to add it.');
      }
      const siteplan = body.mapConfig?.siteplan?.imageUrl;
      if (typeof siteplan === 'string' && !hostedUnder(siteplan, 'siteplans')) {
        issue(['mapConfig', 'siteplan', 'imageUrl'], 'The site plan must be an image uploaded to Festie.');
      }
    });
}

/** A first problem as one sentence, with the field path, for a 400 message. */
export function firstRuleMessage(error: z.ZodError): string {
  const first = error.issues[0];
  const more = error.issues.length > 1 ? ` (and ${error.issues.length - 1} more)` : '';
  return `${first?.message ?? 'Check the links.'}${more}`;
}
