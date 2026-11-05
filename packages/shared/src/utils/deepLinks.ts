import { parseSharedPicksRef } from './sharedPicks';

const OWN_LINK = /^(?:https:\/\/festie\.us|festie:\/\/)\/*/i;

/**
 * Rewrite a web-only public path to the mobile screen that shows the same thing.
 * `/s/<token>` and `/s/u/<name>` are the server-rendered shared-picks pages, so they
 * open friend-picks; `/compare` is the web crew compare, which mobile calls
 * `/crew-compare`. Returns null for any other link, so the caller keeps it as is.
 * `/f/<slug>` has no mobile screen and stays out of the Android intent filter on purpose.
 */
export function rewriteWebPathForApp(raw: string): string | null {
  const own = OWN_LINK.exec(raw);
  if (!own) return null;
  const rest = '/' + raw.slice(own[0].length);
  const cut = rest.search(/[?#]/);
  const pathname = cut < 0 ? rest : rest.slice(0, cut);
  const query = cut < 0 ? '' : rest.slice(cut);
  const parts = pathname.replace(/\/+$/, '').split('/').slice(1);
  if (parts[0] === 'compare' && parts.length === 1) return `/crew-compare${query}`;
  if (parts[0] !== 's') return null;
  const [, first = '', second = ''] = parts;
  const isVanity = first === 'u' && parts.length === 3;
  if (!isVanity && parts.length !== 2) return null;
  let ref: string | null;
  try {
    ref = parseSharedPicksRef(isVanity ? `u/${decodeURIComponent(second)}` : decodeURIComponent(first));
  } catch {
    return null;
  }
  return ref ? `/friend-picks?from=${encodeURIComponent(ref)}` : null;
}
