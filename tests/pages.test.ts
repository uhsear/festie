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
    redirect(url: any) { res._redirectUrl = url; res.headersSent = true; return res; },
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
  const CREW = { id: 'c1', name: 'Bass Gang', festivalId: 'fest-1', maxMembers: 8, inviteExpiresAt: null };

  function inviteDeps(opts: { crew?: any; expired?: any; throws?: boolean; rateCalls?: any[] } = {}) {
    const getByInviteCode = mock.fn(async () => {
      if (opts.throws) throw new Error('db down');
      return opts.crew ?? null;
    });
    return buildDeps({
      stores: {
        crews: {
          getByInviteCode,
          getExpiredByInviteCode: mock.fn(async () => opts.expired ?? null),
          getMembers: mock.fn(async () => [{ userId: 'u1', role: 'owner', username: 'dj', name: 'DJ Dana' }]),
        },
      },
      getFestivalById: mock.fn(async () => ({ id: 'fest-1', name: 'EDC Orlando', days: [{ date: '2026-11-06' }] })),
      rateLimit: (max: any, key: any) => {
        opts.rateCalls?.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
    });
  }

  async function get(deps: any, code: string) {
    const handler = getHandler(createPageRoutes(deps), '/join/:code');
    const res = mockRes();
    await handler(mockReq({ params: { code } }), res);
    return res;
  }

  it('renders 200 HTML with og:title for a valid code', async () => {
    const res = await get(inviteDeps({ crew: CREW }), 'abc123');
    assert.equal(res._status, 200);
    assert.ok(res._sent.includes('og:title" content="Join Bass Gang on Festie"'));
    assert.ok(res._sent.includes('EDC Orlando'));
    assert.ok(res._sent.includes('href="https://festie.us/?joinCrew=ABC123"'));
    assert.ok(res._sent.includes('og:url" content="https://festie.us/join/ABC123"'));
    assert.equal(res._redirectUrl, null);
    assert.equal(res._headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(res._headers['Cache-Control'], 'public, max-age=60');
    assert.equal(res._headers['Content-Security-Policy'], "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  });

  it('returns 404 with the error page for an unknown code', async () => {
    const res = await get(inviteDeps(), 'NOPE99');
    assert.equal(res._status, 404);
    assert.ok(res._sent.includes("This invite doesn't work"));
    assert.ok(res._sent.includes('We couldn&#39;t find a crew with this code.'));
  });

  it('returns 404 when nothing is left of the code', async () => {
    const res = await get(inviteDeps({ crew: CREW }), '<>');
    assert.equal(res._status, 404);
  });

  it('returns 410 for an expired code', async () => {
    const res = await get(inviteDeps({ expired: { id: 'c1' } }), 'OLD123');
    assert.equal(res._status, 410);
    assert.ok(res._sent.includes('This invite has expired. Ask someone in the crew for a new link.'));
  });

  it('escapes a <script> crew name', async () => {
    const res = await get(inviteDeps({ crew: { ...CREW, name: '<script>alert(1)</script>' } }), 'ABC123');
    assert.equal(res._status, 200);
    assert.ok(!res._sent.includes('<script>alert(1)</script>'));
    assert.ok(res._sent.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  });

  it('strips special characters and caps the code at 12 before the lookup', async () => {
    const deps: any = inviteDeps({ crew: CREW });
    await get(deps, 'ab<script>12' + 'X'.repeat(20));
    const looked = (deps.stores.crews.getByInviteCode.mock.calls[0] as any).arguments[0];
    assert.equal(looked, 'ABSCRIPT12XX');
  });

  it('returns 500 with no-store when the store throws', async () => {
    const res = await get(inviteDeps({ throws: true }), 'ABC123');
    assert.equal(res._status, 500);
    assert.equal(res._headers['Cache-Control'], 'no-store');
    assert.ok(res._sent.includes("This invite doesn't work"));
  });

  it('applies the crew-invite-page rate limit', () => {
    const rateCalls: any[] = [];
    createPageRoutes(inviteDeps({ rateCalls }));
    assert.ok(rateCalls.some((c) => c.key === 'crew-invite-page' && c.max === 30));
  });
});

describe('pages: /reset/:token', () => {
  it('shows error page for invalid token format', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token: 'short' } }), res);

    assert.ok(res._sent);
    assert.ok(res._sent.includes('Invalid or expired'), 'should show error message');
    assert.equal(res._headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(res._headers['Cache-Control'], 'no-store, no-cache, must-revalidate');
  });

  it('shows error page for empty token', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token: '' } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows form page for valid token found in admin reset tokens', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const state = {
      _adminResetTokens: new Map([
        [tokenHash, { userId: 'user-1', expiresAt: Date.now() + 3600000 }],
      ]),
    };
    const router = createPageRoutes(buildDeps({ state }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);

    assert.ok(res._sent);
    assert.ok(res._sent.includes('Reset Password'), 'should render reset form');
    assert.ok(res._sent.includes('resetForm'), 'should contain the form element');
  });

  it('shows error for expired admin token', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const state = {
      _adminResetTokens: new Map([
        [tokenHash, { userId: 'user-1', expiresAt: Date.now() - 1000 }],
      ]),
    };
    const router = createPageRoutes(buildDeps({ state }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('falls back to database when token is not in admin map', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({
        rows: [{ userId: 'user-1', expiresAt: new Date(Date.now() + 3600000) }],
      })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);

    assert.equal(pool.query.mock.callCount(), 1);
    assert.ok(res._sent.includes('Reset Password'));
  });

  it('shows error when database returns no rows', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({ rows: [] })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows error page when database query throws', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => { throw new Error('DB down'); }),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token } }), res);
    assert.ok(res._sent.includes('Failed to load reset page'));
  });

  it('sets CSP header on all responses', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset/:token');

    const res = mockRes();
    await handler(mockReq({ params: { token: 'x' } }), res);
    assert.ok(res._headers['Content-Security-Policy']);
  });
});

describe('pages: /reset-password', () => {
  it('shows error for missing token query parameter', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: {} }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows error for invalid token format', async () => {
    const router = createPageRoutes(buildDeps());
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token: 'bad-token' } }), res);
    assert.ok(res._sent.includes('Invalid or expired'));
  });

  it('shows form for valid token in database', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({ rows: [{ id: 1 }] })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token } }), res);
    assert.ok(res._sent.includes('Reset Password'));
    assert.equal(res._headers['Referrer-Policy'], 'no-referrer');
  });

  it('shows expired message when database returns no rows', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => ({ rows: [] })),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token } }), res);
    assert.ok(res._sent.includes('expired or already been used'));
  });

  it('shows error when database throws', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const pool = {
      query: mock.fn(async () => { throw new Error('fail'); }),
    };
    const router = createPageRoutes(buildDeps({ pool }));
    const handler = getHandler(router, '/reset-password');

    const res = mockRes();
    await handler(mockReq({ query: { token } }), res);
    assert.ok(res._sent.includes('Failed to load reset page'));
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
