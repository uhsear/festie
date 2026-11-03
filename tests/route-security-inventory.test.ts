/**
 * Route and socket security inventory (T57 P6). Reads routes/*.ts as text: no app boot, no DB.
 *
 * Every route registration must carry userAuth or adminAuth, Zod validation for the body and
 * query it reads, and a scoped rate limiter on writes. Admin files need adminAuth, and the
 * destructive admin and identity routes keep requireRecentAuth. Every socket event parses its
 * payload with Zod; crew events check membership; join, leave and location events are limited.
 *
 * A failure names the file, line, verb and path. Fix the route, or list it below with a reason.
 * A route that this scanner cannot follow (a handler defined in another file) must be listed,
 * never skipped. When parallel PRs add public routes (T50 /f/:slug, T52, T54 /join/:code/save.ics
 * and the nudge route), the PR that merges second adds its routes to these lists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const SIGN_IN = 'Sign-in entry point; the caller has no session yet.';
const TOKEN_LINK = 'The unguessable token in the link is the credential.';
const PUBLIC_FESTIVAL = 'Public festival read; no user data.';
const SHARE = 'Share link; only a revocable share token or an opt-in username opens a schedule.';
const PUBLIC_ROUTES: Record<string, string> = {
  'admin-metrics.ts GET /internal/metrics-json': 'Loopback-only cron feed; the handler checks the raw socket peer.',
  'analytics-install.ts POST /install': 'Install beacon sent before sign-in.',
  'auth.ts POST /register': SIGN_IN,
  'auth.ts POST /login': SIGN_IN,
  'auth.ts POST /verify': 'Checks the presented session token itself.',
  'auth.ts POST /logout': 'Clears the cookie even when the session has already expired.',
  'auth.ts POST /refresh-token': 'Authenticates with a refresh token, not a session.',
  'calendar-sync.ts GET /cal/:token.ics': TOKEN_LINK,
  'client-metrics.ts POST /web-vitals': 'Web-vitals beacon.',
  'crew-invites.ts GET /join/:inviteCode': 'Invite landing page before sign-in.',
  'crews.ts GET /join-preview/:inviteCode': 'Invite preview before sign-in.',
  'deep-links.ts GET /apple-app-site-association': 'App link association file.',
  'deep-links.ts GET /assetlinks.json': 'App link association file.',
  'email-auth.ts POST /forgot-password': SIGN_IN,
  'email-auth.ts GET /verify-email': TOKEN_LINK,
  'email-auth.ts POST /reset-password': TOKEN_LINK,
  'festival-announcements.ts GET /:id/announcements': 'Published announcements of a published festival.',
  'festival-discovery.ts GET /:festivalId/sets/:setId/also-picked': 'Anonymous set ids behind the CO_PICK_MIN_USERS floor.',
  'festivals.ts GET /': PUBLIC_FESTIVAL,
  'festivals.ts GET /locate-set/:setId': PUBLIC_FESTIVAL,
  'festivals.ts GET /:id/basemap': PUBLIC_FESTIVAL,
  'festivals.ts GET /:id': PUBLIC_FESTIVAL,
  'health-core.ts GET /health': 'Health probe.',
  'health-core.ts POST /metrics/client': 'Client metrics beacon.',
  'health-core.ts POST /csp-report': 'Browser CSP report.',
  'health-core.ts GET /ready': 'Readiness probe.',
  'health-core.ts GET /info': 'Build info probe.',
  'notifications.ts GET /vapid-key': 'Public web-push key.',
  'oauth.ts GET /providers': SIGN_IN,
  'oauth.ts POST /oauth/nonce': SIGN_IN,
  'oauth.ts POST /oauth/complete': SIGN_IN,
  'oauth.ts POST /oauth/:provider': SIGN_IN,
  'pages.ts GET /join/:code': 'Invite page before sign-in.',
  'pages.ts GET /join/:code/save.ics': 'Invite calendar file before sign-in.',
  'pages.ts GET /f/:slug': PUBLIC_FESTIVAL,
  'pages.ts GET /f/:slug/og.png': PUBLIC_FESTIVAL,
  'pages.ts GET /reset/:token': TOKEN_LINK,
  'pages.ts GET /reset-password': TOKEN_LINK,
  'pages.ts GET /privacy': 'Static legal page.',
  'pages.ts GET /terms': 'Static legal page.',
  'pages.ts GET /security-whitepaper': 'Static page.',
  'pages.ts GET /{*splat}': 'SPA shell fallback; the API routes do the auth.',
  'ratings.ts GET /festival/:festivalId/all': 'Per-set counts and averages only; no user ids or notes.',
  'share.ts GET /u/:username/og.png': SHARE,
  'share.ts GET /:shareId/og.png': SHARE,
  'share.ts GET /u/:username/json': SHARE,
  'share.ts GET /u/:username': SHARE,
  'share.ts GET /:profileId': SHARE,
  'share.ts GET /:profileId/json': SHARE,
  'spotify.ts GET /spotify/preview/:setId': 'Public set preview.',
};
const ADMIN_EXEMPT: Record<string, string> = { 'admin-metrics.ts GET /internal/metrics-json': 'Loopback-only; see PUBLIC_ROUTES.' };
const BEACON = 'Beacon: the handler checks types and caps sizes.';
const HAND_VALIDATED_BODY: Record<string, string> = {
  'admin.ts POST /festivals/:id/backfill-spotify': 'Parsed with spotifyBackfillSchema.safeParse in the handler.',
  'analytics-install.ts POST /install': BEACON,
  'client-metrics.ts POST /web-vitals': BEACON,
  'health-core.ts POST /metrics/client': BEACON,
  'health-core.ts POST /csp-report': BEACON,
};
const HAND_VALIDATED_QUERY: Record<string, string> = {
  'email-auth.ts GET /verify-email': 'Reads one token string; the store lookup bounds it.',
  'notifications.ts GET /history': 'Clamps limit and offset by hand.',
  'pages.ts GET /reset-password': 'Reads one token string and only forwards it.',
};
const REQUIRE_RECENT_AUTH = [
  'admin-users.ts POST /users/:id/roles', 'admin-users.ts DELETE /users/:id/roles/:role', 'admin-users.ts POST /users/:id/reset-link',
  'admin-users.ts PUT /users/:id/reset-password', 'admin-users.ts DELETE /users/:id', 'admin-bulk.ts DELETE /crews/:id',
  'admin-bulk.ts POST /bulk/deactivate', 'admin-bulk.ts POST /bulk/archive-festivals', 'festivals.ts DELETE /:id',
  'identities.ts POST /identities/:provider', 'identities.ts DELETE /identities/:provider', 'identities.ts POST /set-password',
];

// Blank out comments but keep line numbers. `/*` and `//` must follow whitespace, so '/set/*' and URLs survive.
const blank = (m: string) => m.replace(/[^\n]/g, ' ');
const stripComments = (s: string) => s.replace(/\r/g, '').replace(/(^|\s)\/\*[\s\S]*?\*\//g, blank).replace(/(^|\s)\/\/.*$/gm, blank);

// Split top-level arguments from `from` (just past an opening bracket). Stops at an inline handler, so bodies are never tokenised.
function splitArgs(src: string, from: number) {
  const args: string[] = [];
  let depth = 0, cur = '', i = from;
  for (; i < src.length; i++) {
    const c = src.charAt(i);
    if (depth === 0 && cur.trim() === '' && /^(async\b|\(|function\b)/.test(src.slice(i, i + 9))) return { args, handlerAt: i, named: '' };
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      cur += src.slice(i, j + 1); i = j; continue;
    }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  return { args: args.slice(0, -1), handlerAt: -1, named: args.at(-1) ?? '' };
}

type Route = { key: string; where: string; file: string; verb: string; path: string; mw: string; body: string };
const files = readdirSync(join(root, 'routes')).filter((f) => f.endsWith('.ts'));
const sources = new Map(files.map((f) => [f, stripComments(readFileSync(join(root, 'routes', f), 'utf8'))]));
// `const|let|function <name>` in `file` first, then in any route file (adminWriteLimit is built in admin.ts).
const defOf = (file: string, name: string, onlyFile = false) => {
  const re = new RegExp(`\\b(?:const|let|function)\\s+${name}\\b\\s*=?\\s*`);
  for (const f of onlyFile ? [file] : [file, ...files]) { const text = sources.get(f) ?? ''; const m = re.exec(text); if (m) return { text, start: m.index, at: m.index + m[0].length }; }
  return null;
};
// A block ends at the first later line indented like the line that opened it (its `});` or `};`).
const blockEnd = (src: string, opener: number, from: number) => {
  const indent = /^ */.exec(src.slice(src.lastIndexOf('\n', opener) + 1))![0];
  const re = new RegExp(`\\n${indent}\\S`, 'g');
  re.lastIndex = Math.max(0, src.indexOf('\n', from));
  const m = re.exec(src);
  return m ? m.index + indent.length + 2 : src.length;
};

const problems: string[] = [];
const routes: Route[] = [];
for (const file of files) {
  const src = sources.get(file) ?? '';
  for (const m of src.matchAll(/\b(\w*[rR]outer|app)\.(get|post|put|patch|delete)\(/g)) {
    const where = `routes/${file}:${src.slice(0, m.index).split('\n').length}`;
    const { args: [rawPath = '', ...mwArgs], handlerAt, named } = splitArgs(src, m.index + m[0].length);
    const path = rawPath.replace(/^['"`]|['"`]$/g, '');
    const verb = m[2]!.toUpperCase();
    const mw: string[] = [];
    for (const a of mwArgs) {
      const def = /^(\.\.\.)?\w+$/.test(a) ? defOf(file, a.replace(/^\.\.\./, '')) : null;
      const spread = a.startsWith('...') && def ? splitArgs(def.text, def.at + 1) : null;
      if (spread) mw.push(...spread.args, spread.named);
      else mw.push(def ? `${a} = ${def.text.slice(def.at).split('\n')[0]}` : a);
    }
    let body = handlerAt >= 0 ? src.slice(handlerAt, blockEnd(src, m.index, handlerAt)) : '';
    if (handlerAt < 0) {
      const def = defOf(file, named.replace(/\(.*$/s, ''), true);
      if (def) body = src.slice(def.at, blockEnd(src, def.start, def.at));
      else problems.push(`${where} ${verb} ${path}: cannot follow handler "${named}". Define it in this file, or list the route with a reason.`);
    }
    routes.push({ key: `${file} ${verb} ${path}`, where, file, verb, path, mw: mw.join(' | '), body });
  }
}
// A file counts as admin when server.ts mounts it only as `app.use('<prefix>', deps.adminAuth, <router>)`:
// every factory it exports is called once, and its router variable appears nowhere but admin mounts.
const serverSrc = stripComments(readFileSync(join(root, 'server.ts'), 'utf8'));
const adminMounted = new Set(files.filter((f) => {
  const imp = new RegExp(`import\\s+(\\w+|\\{[^}]+\\})\\s+from\\s+'\\./routes/${f.replace(/\.ts$/, '')}(?:\\.js)?'`).exec(serverSrc);
  const factories = imp ? imp[1]!.replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter(Boolean) : [];
  return factories.length > 0 && factories.every((fn) => {
    const v = serverSrc.split(`${fn}(`).length === 2 ? new RegExp(`const\\s+(\\w+)\\s*=\\s*${fn}\\(deps\\);`).exec(serverSrc)?.[1] : undefined;
    if (!v) return false;
    const adminUses = serverSrc.match(new RegExp(`app\\.use\\('[^']*',\\s*deps\\.adminAuth,\\s*${v}\\)`, 'g'))?.length ?? 0;
    return adminUses > 0 && serverSrc.match(new RegExp(`\\b${v}\\b`, 'g'))!.length === adminUses + 1;
  });
}));
const has = (r: Route, re: RegExp) => re.test(r.mw);
const isAdmin = (r: Route) => adminMounted.has(r.file) || has(r, /(^|[\s.|])adminAuth\b/);
const isAuthed = (r: Route) => isAdmin(r) || has(r, /(^|[\s|])userAuth\b/);
const fail = (r: Route, msg: string) => problems.push(`${r.where} ${r.verb} ${r.path}: ${msg}`);

const socketSrc = stripComments(readFileSync(join(root, 'routes/socket.ts'), 'utf8'));
const socketRegs = [...socketSrc.matchAll(/socket\.on\('([\w:]+)'/g)];
const sockets = socketRegs.map((m, i) => ({ event: m[1]!, body: socketSrc.slice(m.index, socketRegs[i + 1]?.index ?? socketSrc.length) }));
const NO_PAYLOAD_EVENTS: Record<string, string> = { 'leave:festival': 'Takes no payload.' };
const CREW_EVENTS = ['join:crew', 'leave:crew', 'location:share', 'location:update', 'location:stop', 'location:sync'];
const LIMITED_EVENTS = ['join:festival', 'leave:festival', 'join:crew', 'leave:crew', 'location:share', 'location:sync', 'location:update'];

test('route security inventory', () => {
  for (const r of routes) {
    if (!isAuthed(r) && !PUBLIC_ROUTES[r.key]) fail(r, `no session middleware. Add userAuth, or add '${r.key}' to PUBLIC_ROUTES with a reason.`);
    if (r.file.startsWith('admin') && !isAdmin(r) && !ADMIN_EXEMPT[r.key]) fail(r, 'admin route without adminAuth. Add adminAuth.');
    if (/\b_?req\.(body|validatedBody)\b/.test(r.body) && !has(r, /\bvalidate\(/) && !HAND_VALIDATED_BODY[r.key]) fail(r, `reads the body without validate(schemas.x). Add a Zod schema in lib/schemas.ts, or add '${r.key}' to HAND_VALIDATED_BODY with a reason.`);
    if (/\b_?req\.(query|validatedQuery)\b/.test(r.body) && !has(r, /\bvalidateQuery\(/) && !HAND_VALIDATED_QUERY[r.key]) fail(r, `reads the query without validateQuery(schemas.x). Add one, or add '${r.key}' to HAND_VALIDATED_QUERY with a reason.`);
    if (r.verb !== 'GET' && !has(r, /\b(rateLimit|rl)\(/)) fail(r, 'write route without a scoped rate limiter. Add rateLimit(max, scope).');
  }
  const keys = new Set(routes.map((r) => r.key));
  for (const key of REQUIRE_RECENT_AUTH) {
    const matches = routes.filter((r) => r.key === key);
    if (!matches.length) problems.push(`REQUIRE_RECENT_AUTH lists '${key}', which matches no route. Update the list in the same change.`);
    for (const r of matches) if (!has(r, /\brequireRecentAuth\b/)) fail(r, 'lost requireRecentAuth. Put it back after the limiter.');
  }
  for (const list of [PUBLIC_ROUTES, HAND_VALIDATED_BODY, HAND_VALIDATED_QUERY, ADMIN_EXEMPT]) {
    for (const key of Object.keys(list)) if (!keys.has(key)) problems.push(`Allowlist entry '${key}' matches no route. Remove it.`);
  }
  const events = sockets.filter((s) => s.event !== 'disconnect').length;
  console.log(`routes: ${routes.length} total, ${routes.filter((r) => !isAuthed(r)).length} public, ${routes.filter(isAdmin).length} admin; sockets: ${events} events`);
  assert.equal(problems.length, 0, `\n${problems.join('\n')}`);
});

test('socket event inventory', () => {
  const issues: string[] = [];
  const helperAt = socketSrc.indexOf('async function authenticateAndJoinRoom');
  const helperLimits = helperAt >= 0 && socketSrc.slice(helperAt, blockEnd(socketSrc, helperAt, helperAt)).includes('consumeSocketRateLimit(');
  const limiter = new RegExp(`consumeSocketRateLimit\\(|\\.consumeAsync\\(${helperLimits ? '|authenticateAndJoinRoom\\(' : ''}`);
  const byEvent = new Map(sockets.map((s) => [s.event, s.body]));
  for (const { event, body } of sockets) {
    if (event !== 'disconnect' && !NO_PAYLOAD_EVENTS[event] && !body.includes('.safeParse(')) issues.push(`socket ${event}: payload not parsed with a Zod safeParse.`);
  }
  for (const event of CREW_EVENTS) {
    if (!/getMember\(|socket\.data\??\.(crewId|sharingCrewId)/.test(byEvent.get(event) ?? '')) issues.push(`socket ${event}: no crew membership check (getMember or socket.data.crewId/sharingCrewId).`);
  }
  for (const event of LIMITED_EVENTS) {
    if (!limiter.test(byEvent.get(event) ?? '')) issues.push(`socket ${event}: no rate limiter (consumeSocketRateLimit).`);
  }
  assert.equal(issues.length, 0, `\n${issues.join('\n')}`);
});
