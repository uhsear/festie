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

  it('returns 403 with the locked message for a locked crew', async () => {
    const res = await get(inviteDeps({ crew: { ...CREW, inviteLocked: true } }), 'ABC123');
    assert.equal(res._status, 403);
    assert.ok(res._sent.includes("This invite doesn't work"));
    assert.ok(res._sent.includes('This crew isn&#39;t taking new members.'));
    assert.ok(!res._sent.includes('Bass Gang'));
  });

  it('links Save for later on a dated invite page', async () => {
    const res = await get(inviteDeps({ crew: CREW }), 'abc123');
    assert.ok(res._sent.includes('href="https://festie.us/join/ABC123/save.ics"'));
  });
});

describe('pages: /join/:code/save.ics', () => {
  const CREW = { id: 'c1', name: 'Bass, Gang', festivalId: 'fest-1', maxMembers: 8, inviteExpiresAt: null };
  const MEMBERS = [
    { userId: 'u-1', role: 'owner', username: 'ana', name: 'Ana Lopez' },
    { userId: 'u-2', role: 'member', username: 'ben', name: 'Ben Ortiz' },
  ];
  const DATED = { id: 'fest-1', name: 'EDC Orlando', days: [{ date: '2026-11-08' }, { date: '2026-11-06' }] };

  function icsDeps(opts: { crew?: any; festival?: any; throws?: boolean; rateCalls?: any[] } = {}) {
    return buildDeps({
      stores: {
        crews: {
          getByInviteCode: mock.fn(async () => {
            if (opts.throws) throw new Error('db down');
            return opts.crew ?? null;
          }),
          getExpiredByInviteCode: mock.fn(async () => null),
          getMembers: mock.fn(async () => MEMBERS),
        },
      },
      getFestivalById: mock.fn(async () => opts.festival ?? DATED),
      rateLimit: (max: any, key: any) => {
        opts.rateCalls?.push({ max, key });
        return (_req: any, _res: any, next: any) => next();
      },
    });
  }

  async function get(deps: any, code: string) {
    const handler = getHandler(createPageRoutes(deps), '/join/:code/save.ics');
    const res = mockRes();
    await handler(mockReq({ params: { code } }), res);
    return res;
  }

  it('is registered after /join/:code and before the SPA catch-all', () => {
    const paths = createPageRoutes(icsDeps())._routes.map((r: any) => r.path);
    const ics = paths.indexOf('/join/:code/save.ics');
    assert.ok(ics > paths.indexOf('/join/:code'));
    assert.ok(ics < paths.indexOf('/{*splat}'));
  });

  it('returns the calendar with download headers', async () => {
    const res = await get(icsDeps({ crew: CREW }), 'abc123');
    assert.equal(res._status, 200);
    assert.equal(res._redirectUrl, null);
    assert.equal(res._headers['Content-Type'], 'text/calendar; charset=utf-8');
    assert.equal(res._headers['Content-Disposition'], 'attachment; filename="festie-invite.ics"');
    assert.equal(res._headers['Cache-Control'], 'no-store');
    const ics = res._sent.replace(/\r\n /g, '');
    assert.equal(ics.split('BEGIN:VEVENT').length - 1, 1);
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20261106'));
    assert.ok(ics.includes('DTEND;VALUE=DATE:20261109'));
    assert.ok(ics.includes('https://festie.us/join/ABC123'));
    assert.ok(ics.includes('Bass\\, Gang'));
  });

  it('carries no owner name, member name or user id', async () => {
    const res = await get(icsDeps({ crew: CREW }), 'ABC123');
    const ics = res._sent.replace(/\r\n /g, '');
    for (const leak of ['Ana Lopez', 'Ben Ortiz', 'ana', 'ben', 'u-1', 'u-2']) {
      assert.ok(!ics.includes(leak), `ICS leaks ${leak}`);
    }
  });

  it('redirects to the invite page for an invalid code', async () => {
    const res = await get(icsDeps(), 'NOPE99');
    assert.equal(res._status, 302);
    assert.equal(res._redirectUrl, '/join/NOPE99');
  });

  it('redirects to / when nothing is left of the code', async () => {
    const res = await get(icsDeps({ crew: CREW }), '<>');
    assert.equal(res._status, 302);
    assert.equal(res._redirectUrl, '/');
  });

  it('redirects for a locked crew', async () => {
    const res = await get(icsDeps({ crew: { ...CREW, inviteLocked: true } }), 'ABC123');
    assert.equal(res._status, 302);
    assert.equal(res._redirectUrl, '/join/ABC123');
    assert.equal(res._headers['Content-Type'], undefined);
  });

  it('redirects when the festival has no dated days', async () => {
    const res = await get(icsDeps({ crew: CREW, festival: { id: 'fest-1', name: 'EDC Orlando', days: [] } }), 'ABC123');
    assert.equal(res._status, 302);
    assert.equal(res._redirectUrl, '/join/ABC123');
  });

  it('logs and redirects when the store throws', async () => {
    const deps: any = icsDeps({ throws: true });
    const res = await get(deps, 'ABC123');
    assert.equal(res._status, 302);
    assert.equal(res._redirectUrl, '/join/ABC123');
    assert.equal((deps.log.error.mock.calls[0] as any).arguments[0], 'crew invite ics failed');
  });

  it('applies the crew-invite-page rate limit', () => {
    const rateCalls: any[] = [];
    createPageRoutes(icsDeps({ rateCalls }));
    assert.equal(rateCalls.filter((c) => c.key === 'crew-invite-page' && c.max === 30).length, 2);
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
