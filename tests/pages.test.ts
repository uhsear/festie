import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import crypto from 'crypto';

import createPageRoutes from '../routes/pages';

// ---------------------------------------------------------------------------
// Helpers — mock factories
// ---------------------------------------------------------------------------

function createMockRouter() {
  const routes: any[] = [];
  const handler = (method: any) => (pathPattern: any, ...handlers: any[]) => {
    routes.push({ method, path: pathPattern, handlers });
  };
  return {
    get: handler('GET'),
    post: handler('POST'),
    put: handler('PUT'),
    delete: handler('DELETE'),
    use: handler('USE'),
    _routes: routes,
  };
}

function createMockExpress() {
  const fn: any = () => {};
  fn.Router = () => createMockRouter();
  fn.static = () => (_req: any, _res: any, next: any) => next();
  return fn;
}

function mockReq(overrides: any = {}) {
  return {
    params: {},
    query: {},
    path: '/',
    method: 'GET',
    headers: {},
    ...overrides,
  };
}

function mockRes() {
  const res: any = {
    _status: 200,
    _headers: {} as any,
    _sent: null as any,
    _redirectUrl: null as any,
    _sentFile: null as any,
    headersSent: false,
    status(code: any) { res._status = code; return res; },
    setHeader(k: any, v: any) { res._headers[k] = v; return res; },
    send(body: any) { res._sent = body; res.headersSent = true; return res; },
    json(body: any) { res._sent = JSON.stringify(body); res.headersSent = true; return res; },
    redirect(a: any, b?: any) {
      if (b === undefined) { res._redirectUrl = a; } else { res._status = a; res._redirectUrl = b; }
      res.headersSent = true;
      return res;
    },
    sendFile(filePath: any, cb: any) { res._sentFile = filePath; if (cb) cb(); return res; },
    end() { res.headersSent = true; return res; },
  };
  return res;
}

function buildDeps(overrides: any = {}) {
  const express = createMockExpress();
  return {
    express,
    config: {
      PUBLIC_ORIGIN: 'https://festie.us',
      PUBLIC_DIR: 'C:\\fake\\public',
      AUTH_RATE_LIMIT_MAX: 10,
      ...overrides.config,
    },
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    pool: {
      query: async () => ({ rows: [], rowCount: 0 }),
      ...overrides.pool,
    },
    state: {
      _adminResetTokens: new Map(),
      ...overrides.state,
    },
    log: {
      info: mock.fn(),
      warn: mock.fn(),
      error: mock.fn(),
      debug: mock.fn(),
    },
    sendError: (res: any, status: any, msg: any, code: any) => res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
    ...overrides,
  };
}

function getHandler(router: any, path: string) {
  const route = router._routes.find((r: any) => r.path === path);
  if (!route) throw new Error(`Route not found: ${path}`);
  return route.handlers[route.handlers.length - 1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pages: route registration', () => {
  it('registers all expected routes', () => {
    const router = createPageRoutes(buildDeps());
    const paths = router._routes.map((r: any) => r.path);

    assert.ok(paths.includes('/join/:code'));
    assert.ok(paths.includes('/reset/:token'));
    assert.ok(paths.includes('/reset-password'));
    assert.ok(paths.includes('/privacy'));
    assert.ok(paths.includes('/terms'));
    assert.ok(paths.includes('/security-whitepaper'));
    assert.ok(paths.includes('/{*splat}'));
  });

  it('all routes use GET method', () => {
    const router = createPageRoutes(buildDeps());
    for (const route of router._routes) {
      assert.equal(route.method, 'GET');
    }
  });
});

describe('pages: /join/:code', () => {
  it('redirects with valid code', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: 'ABC123' } }), res);
    assert.equal(res._redirectUrl, '/?joinCrew=ABC123');
  });

  it('redirects to / for empty code', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: '' } }), res);
    assert.equal(res._redirectUrl, '/');
  });

  it('strips special characters', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: 'AB<script>12' } }), res);
    assert.equal(res._redirectUrl, '/?joinCrew=ABscript12');
  });

  it('truncates to 10 chars', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/join/:code');

    const res = mockRes();
    handler(mockReq({ params: { code: 'A'.repeat(20) } }), res);
    assert.equal(res._redirectUrl, '/?joinCrew=' + 'A'.repeat(10));
  });
});

const EXPIRED = '/forgot-password?expired=1';

describe('pages: /reset/:token', () => {
  for (const [label, token] of [['malformed', 'short'], ['empty', ''], ['uppercase hex', 'A'.repeat(64)]]) {
    it(`redirects 303 to forgot-password for a ${label} token`, async () => {
      const router = createPageRoutes(buildDeps());
      const handler = getHandler(router, '/reset/:token');

      const res = mockRes();
      await handler(mockReq({ params: { token } }), res);
      assert.equal(res._status, 303);
      assert.equal(res._redirectUrl, EXPIRED);
    });
  }

  it('redirects 302 to the SPA reset page and keeps no in-memory copy', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const state = { _adminResetTokens: new Map() };
    const pool = { query: mock.fn(async () => ({ rows: [{ id: 1 }] })) };
    const router = createPageRoutes(buildDeps({ state, pool }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);
    assert.equal(res._status, 302);
    assert.equal(res._redirectUrl, `/reset-password?token=${token}`);
    assert.equal(state._adminResetTokens.size, 0);
    assert.equal(pool.query.mock.callCount(), 0);
  });
});

describe('pages: /reset-password', () => {
  async function run(query: any, pool?: any) {
    const router = createPageRoutes(buildDeps(pool ? { pool } : {}));
    const handler = getHandler(router, '/reset-password');
    const res = mockRes();
    const next = mock.fn();
    await handler(mockReq({ query }), res, next);
    return { res, next };
  }

  for (const [label, query] of [['missing', {}], ['malformed', { token: 'bad-token' }], ['non-string', { token: ['a'] }]]) {
    it(`redirects 303 to forgot-password for a ${label} token`, async () => {
      const { res, next } = await run(query);
      assert.equal(res._status, 303);
      assert.equal(res._redirectUrl, EXPIRED);
      assert.equal(next.mock.callCount(), 0);
    });
  }

  it('redirects 303 when the token is unknown, used or expired', async () => {
    const pool = { query: mock.fn(async () => ({ rows: [] })) };
    const { res, next } = await run({ token: crypto.randomBytes(32).toString('hex') }, pool);
    assert.equal(pool.query.mock.callCount(), 1);
    assert.equal(res._status, 303);
    assert.equal(res._redirectUrl, EXPIRED);
    assert.equal(next.mock.callCount(), 0);
  });

  it('hands a valid token to the SPA fallback with no-store', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = { query: mock.fn(async () => ({ rows: [{ id: 1 }] })) };
    const { res, next } = await run({ token }, pool);
    const [, params] = (pool.query.mock.calls[0]?.arguments ?? []) as any[];
    assert.deepEqual(params, [crypto.createHash('sha256').update(token).digest('hex')]);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(next.mock.calls[0]?.arguments.length, 0);
    assert.equal(res._sent, null);
    assert.equal(res._redirectUrl, null);
    assert.equal(res._headers['Cache-Control'], 'no-store');
    assert.equal(res._headers['Content-Security-Policy'], undefined);
  });

  it('falls through to the SPA when the database throws', async () => {
    const pool = { query: mock.fn(async () => { throw new Error('fail'); }) };
    const { res, next } = await run({ token: crypto.randomBytes(32).toString('hex') }, pool);
    assert.equal(next.mock.callCount(), 1);
    assert.equal(res._sent, null);
  });
});

describe('pages: static routes', () => {
  it('/privacy serves privacy.html', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/privacy');

    const res = mockRes();
    handler(mockReq(), res);
    assert.ok(res._sentFile);
    assert.ok(res._sentFile.includes('privacy.html'));
  });

  it('/terms serves terms.html', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/terms');

    const res = mockRes();
    handler(mockReq(), res);
    assert.ok(res._sentFile.includes('terms.html'));
  });

  it('/security-whitepaper serves security-whitepaper.html', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/security-whitepaper');

    const res = mockRes();
    handler(mockReq(), res);
    assert.ok(res._sentFile.includes('security-whitepaper.html'));
  });
});

describe('pages: SPA catch-all', () => {
  it('returns 404 for /uploads/ paths', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/{*splat}');

    const res = mockRes();
    handler(mockReq({ path: '/uploads/avatar.png' }), res, () => {});
    assert.equal(res._status, 404);
  });

  it('sets no-store cache header for non-upload paths', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/{*splat}');

    const res = mockRes();
    handler(mockReq({ path: '/dashboard' }), res, () => {});
    assert.equal(res._headers['Cache-Control'], 'no-store');
  });

  it('serves index.html for SPA routes', () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/{*splat}');

    const res = mockRes();
    handler(mockReq({ path: '/festivals/1/schedule' }), res, () => {});
    assert.ok(res._sentFile, 'should attempt to serve SPA index');
  });
});
