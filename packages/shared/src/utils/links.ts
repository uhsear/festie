/**
 * Public share / deep-link URL builders — ONE definition per link, shared by
 * web (React + Vite SPA) and mobile (Expo / React Native).
 *
 * Before this module the same templates were hand-written at every call site:
 *   - `${window.location.origin}/join/${code}` (web CrewInviteBar)
 *   - `https://festie.us/join/${code}`         (mobile crew share)
 *   - `https://festie.us/set/${id}`            (mobile set share)
 *   - `https://festie.us/s/${profileId}`       (web + mobile picks share)
 *   - `https://festie.us`                      (web DetailPanel fallback)
 *   - `festie://…`                             (mobile deep links / Maestro)
 * Divergent origins (web used the live origin, mobile hard-coded the host) meant
 * a copied link could point at the wrong place. These builders centralise the
 * host + path shape so both apps emit identical, correctly-encoded URLs.
 *
 * Pure, no globals — safe for both web and React Native. Web call sites that
 * want the runtime origin (e.g. localhost in dev) pass it in via `origin`.
 */

/** Canonical public host for production share links. */
export const FESTIE_ORIGIN = 'https://festie.us';

/** Custom URL scheme registered by the mobile app (app.json `scheme`). */
export const FESTIE_SCHEME = 'festie://';

/**
 * Join the public origin and a path into one absolute URL, collapsing the
 * slash at the seam so callers never produce `festie.us//join`.
 *
 * @param path   Path beginning with `/` (e.g. `/join/ABC`).
 * @param origin Origin override (web passes `window.location.origin` so dev /
 *               preview hosts work); defaults to the production host.
 */
function absolute(path: string, origin: string = FESTIE_ORIGIN): string {
  const base = origin.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? path : `/${path}`;
  return `${base}${rel}`;
}

/**
 * Crew-invite join link: `<origin>/join/<inviteCode>`.
 *
 * `festie.us/join/CODE` is a server-rendered invite page (routes/pages.ts) with
 * a share preview and a Join button, rather than the machinery
 * `/api/v1/crews/join` URL. The code is percent-encoded so odd codes can't
 * break the URL.
 */
export function buildJoinUrl(inviteCode: string, origin?: string): string {
  return absolute(`/join/${encodeURIComponent(inviteCode)}`, origin);
}

/**
 * Shareable artist deep link: `<origin>/set/<setId>`.
 *
 * `festie.us` is the registered universal-link host (mobile app.json) and the
 * `festie://` scheme also resolves `set/<id>`, so the link deep-links into the
 * app when installed and falls back to the web `/set/$setId` route otherwise.
 */
export function buildSetUrl(setId: string, origin?: string): string {
  return absolute(`/set/${encodeURIComponent(setId)}`, origin);
}

/**
 * Public read-only picks link: `<origin>/s/<profileId>`.
 * Mirrors the server route `GET /s/:profileId`.
 */
export function buildPicksShareUrl(profileId: string, origin?: string): string {
  return absolute(`/s/${encodeURIComponent(profileId)}`, origin);
}

/**
 * Opt-in public schedule page: `<origin>/s/u/<username>`.
 * Mirrors the server route `GET /s/u/:username`, which 404s unless the user
 * turned on `publicSchedule`.
 */
export function buildPublicScheduleUrl(username: string, origin?: string): string {
  return absolute(`/s/u/${encodeURIComponent(username)}`, origin);
}

/**
 * Bare home link (`<origin>`), used as the share-sheet URL where there is no
 * per-resource public page (e.g. web DetailPanel's set share text).
 */
export function buildHomeUrl(origin: string = FESTIE_ORIGIN): string {
  return origin.replace(/\/+$/, '');
}

/**
 * `festie://`-scheme deep link for an in-app path. The mobile app and the
 * Maestro flows open paths like `festie:///find` or `festie://set/<id>`.
 * The returned string preserves the exact slash shape of the input path:
 *   buildAppDeepLink('/find')     -> 'festie:///find'   (absolute path)
 *   buildAppDeepLink('set/123')   -> 'festie://set/123' (scheme-relative)
 */
export function buildAppDeepLink(path: string): string {
  return `${FESTIE_SCHEME}${path}`;
}

const AUTH_PATH_PREFIXES = ['/login', '/register', '/forgot-password', '/(auth)'];

/**
 * Validate a post-sign-in return path. This is the open-redirect trust
 * boundary: only a same-origin absolute path (at most 512 characters, no
 * leading `//` or `/\`, no control characters) passes. Auth screens return
 * null so sign-in never loops back to itself.
 */
export function safeReturnPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 512 || raw[0] !== '/') return null;
  if (raw[1] === '/' || raw[1] === '\\') return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  if (AUTH_PATH_PREFIXES.some((prefix) => raw.startsWith(prefix))) return null;
  return raw;
}
