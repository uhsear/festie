/**
 * Sentry initialization wrapper — optional and safe.
 *
 * If @sentry/node is not installed OR SENTRY_DSN is unset, this becomes a
 * no-op and the exported `sentry` object mirrors the public API with stubs.
 */

import { createRequire } from 'module';
import { loadConfig } from './config.js';
import { redactInviteCodePath } from './helpers/sanitize.js';

let _loaded: ReturnType<typeof loadConfig> | undefined;
const cfg = () => (_loaded ??= loadConfig());
const _require = createRequire(import.meta.url);

let Sentry: any = null;
let initialized = false;
let noop = true;

const REDACT_MAX_DEPTH = 8;
const REDACT_MAX_NODES = 2000;

/**
 * Replaces every string inside an object or array with its invite-code-redacted form, in place, and returns the value.
 * Bounded so a hostile or huge event cannot hang the process: it stops below depth 8 and after 2000 visited nodes,
 * and a WeakSet skips cycles. Past those limits a string is left as is.
 */
function redactDeep<T>(value: T, depth = 0, state = { nodes: 0, seen: new WeakSet<object>() }): T {
  if (typeof value === 'string') return redactInviteCodePath(value) as T;
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return value;
  if (depth >= REDACT_MAX_DEPTH || state.seen.has(value)) return value;
  state.seen.add(value);
  const holder = value as Record<string, unknown>;
  for (const key of Object.keys(holder)) {
    if (++state.nodes > REDACT_MAX_NODES) break;
    holder[key] = redactDeep(holder[key], depth + 1, state);
  }
  return value;
}

/** Runs `ours` first, then the caller's hook on its result. A null from either drops the item. */
function composeHook(ours: (item: any) => any, theirs?: (item: any, hint?: any) => any) {
  return (item: any, hint?: any) => {
    const scrubbed = ours(item);
    return scrubbed == null || typeof theirs !== 'function' ? scrubbed : theirs(scrubbed, hint);
  };
}

function scrubErrorEvent(event: any) {
  // Strip obvious PII paths
  if (event.request && event.request.headers) {
    delete event.request.headers.cookie;
    delete event.request.headers.authorization;
  }
  // An invite code in a URL, referer, message or any other field is a live credential.
  return redactDeep(event);
}

function initSentry(options: any = {}) {
  if (initialized) return Sentry;
  initialized = true;

  const dsn = options.dsn || cfg().SENTRY_DSN;
  if (!dsn) {

    console.warn('[sentry] SENTRY_DSN not set — Sentry disabled (no-op mode)');
    noop = true;
    return null;
  }

  try {

    Sentry = _require('@sentry/node');
  } catch {

    console.warn('[sentry] @sentry/node not installed — Sentry disabled (no-op mode)');
    noop = true;
    Sentry = null;
    return null;
  }

  // dist/instrument.js (the --import preload) and dist/server.js each bundle their
  // own copy of this module but share one @sentry/node, so adopt its client.
  // A caller that passes client overrides (`extra`, e.g. a test transport) still gets its own.
  if (!options.extra && Sentry.getClient?.()) {
    noop = false;
    return Sentry;
  }

  const extra = options.extra ?? {};
  try {
    Sentry.init({
      dsn,
      environment: options.environment || cfg().NODE_ENV || 'production',
      release: options.release || cfg().SENTRY_RELEASE || cfg().APP_VERSION || 'dev',
      tracesSampleRate: Number(cfg().SENTRY_TRACES_RATE ?? 0.05),
      // SDK 11 defaults to streamed v2 spans, which Performance and Transactions do not show.
      traceLifecycle: 'static',
      profilesSampleRate: Number(cfg().SENTRY_PROFILES_RATE ?? 0),
      // @sentry/node 11 replaced sendDefaultPii with dataCollection, and an unset
      // dataCollection now collects cookies, request/response bodies and query data.
      // This is the v10 sendDefaultPii:false baseline from the Sentry migration guide.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: {
          request: { deny: ['forwarded', 'referer', '-ip', 'remote-', 'via', '-user'] },
          response: { deny: ['forwarded', '-ip', 'remote-', 'via', '-user'] },
        },
        httpBodies: [],
        urlQueryParams: { deny: ['forwarded', 'token', '-ip', 'remote-', 'via', '-user'] },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        graphQL: { document: false, variables: false },
      },
      ...extra,
      // Ours run first and always; a caller hook sees the scrubbed value and cannot replace them.
      beforeSend: composeHook(scrubErrorEvent, extra.beforeSend),
      beforeSendTransaction: composeHook(redactDeep, extra.beforeSendTransaction),
      beforeBreadcrumb: composeHook(redactDeep, extra.beforeBreadcrumb),
      // traceLifecycle is 'static', so the span callback takes a SpanJSON through withStaticSpan.
      beforeSendSpan: Sentry.withStaticSpan(composeHook(redactDeep, extra.beforeSendSpan)),
    });
    noop = false;
    console.debug('[sentry] initialized', { env: options.environment || cfg().NODE_ENV, release: options.release || cfg().SENTRY_RELEASE || cfg().APP_VERSION });
    return Sentry;
  } catch (err: any) {

    console.warn('[sentry] init failed — no-op mode', err.message);
    Sentry = null;
    noop = true;
    return null;
  }
}

const sentry = {
  get available() { return !noop && Sentry !== null; },
  captureException(err: any, context?: any) {
    if (noop || !Sentry) return;
    try { Sentry.captureException(err, context); } catch { /* noop */ }
  },
  captureMessage(msg: string, level = 'info') {
    if (noop || !Sentry) return;
    try { Sentry.captureMessage(msg, level); } catch { /* noop */ }
  },
  setUser(user: any) {
    if (noop || !Sentry) return;
    try { Sentry.setUser(user); } catch { /* noop */ }
  },
  setTag(key: string, value: any) {
    if (noop || !Sentry) return;
    try { Sentry.setTag(key, value); } catch { /* noop */ }
  },
  /**
   * Per-request isolation scope. No-op passthrough when Sentry is disabled.
   *
   * Sentry's Node httpIntegration normally creates one isolation scope per
   * request automatically, via import-in-the-middle patching of `http`. tsx
   * installs its own ESM loader that defeats that patching (see server.ts),
   * so nothing else does this here — without it, concurrent requests would
   * read/write the SAME scope and bleed tags/user into each other's events.
   * `withIsolationScope`/`getIsolationScope` only need AsyncLocalStorage,
   * which tsx does NOT break, so this still isolates correctly per request.
   *
   * Mount FIRST in the middleware chain (see lib/middleware.ts) so its
   * wrapped `next()` covers every later middleware, route, and the error
   * handler below.
   */
  requestScope() {
    return (_req: any, _res: any, next: any) => {
      if (noop || !Sentry) return next();
      Sentry.withIsolationScope(() => next());
    };
  },
  /**
   * Wires Sentry's Express request+error capture directly onto `app` (no-op
   * if Sentry is unavailable). @sentry/node v8+ removed `Sentry.Handlers` —
   * the SDK now exposes a single `setupExpressErrorHandler(app)` that calls
   * `app.use()` itself, so this takes `app` rather than returning a
   * middleware for the caller to `.use()`. Call once, after all routes are
   * mounted and before any other error-handling middleware.
   *
   * Also mounts an error-handling middleware, just before Sentry's own, that
   * attaches request attribution to the isolation scope opened by
   * requestScope() above: an opaque user id (never email/username/IP), the
   * request id + trace id, the route PATTERN (req.route.path — not the raw
   * URL, which may contain ids), and the HTTP method. Reading these off
   * `req` here (at error time) rather than eagerly means req.user is
   * already set for authenticated routes (userAuth/adminAuth run earlier,
   * before an error can reach this handler) and req.route is already
   * matched.
   */
  setupExpressErrorHandler(app: any) {
    if (noop || !Sentry || typeof Sentry.setupExpressErrorHandler !== 'function') return;
    app.use((err: any, req: any, _res: any, next: any) => {
      try {
        const scope = Sentry.getIsolationScope();
        if (req?.user?.userId) scope.setUser({ id: String(req.user.userId) });
        if (req?.id) scope.setTag('requestId', req.id);
        if (req?.traceId) scope.setTag('traceId', req.traceId);
        if (req?.method) scope.setTag('method', req.method);
        const routePath = req?.route?.path ? `${req.baseUrl || ''}${req.route.path}` : undefined;
        if (routePath) scope.setTag('route', routePath);
      } catch { /* noop */ }
      next(err);
    });
    try { Sentry.setupExpressErrorHandler(app); } catch { /* noop */ }
  },
  /** Flush pending events before shutdown. */
  async close(timeoutMs = 2000) {
    if (noop || !Sentry) return;
    try { if (Sentry.close) await Sentry.close(timeoutMs); } catch { /* noop */ }
  },
  /** Underlying @sentry/node or null. */
  get raw() { return Sentry; },
};

export { initSentry, sentry, scrubErrorEvent, redactDeep, composeHook };
