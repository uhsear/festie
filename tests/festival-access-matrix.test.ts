import 'dotenv/config';
/**
 * Access matrix for every festival route (OP-1.1).
 *
 * buildFestivalMounts() is the one list of mounts server.ts uses. This test reads each router's own
 * stack and requires every route to carry festivalAccess, to sit behind a mount-level adminAuth, or to
 * appear in a reviewed list. It then calls every route through the real app as an anonymous caller,
 * a signed-in non-admin and an admin, and compares the status codes to a baseline recorded on the
 * branch before festivalAccess replaced the inline adminAuth. Organizations do not exist yet, so the
 * non-admin cell stands for every organizer role: each must get the admin-only answer.
 *
 * The first describe runs without a database. The second needs TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, afterEach, describe, test } from 'node:test';
import express from 'express';
import { createSessionHelpers, FESTIVAL_ACTIONS } from '../lib/app-context/session';
import { buildFestivalMounts } from '../lib/festival-mounts';
import { TEST_DATABASE_URL, skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');

// Construction-only deps: handlers never run, so every dependency except express and the real
// festivalAccess is a callable that returns itself.
function constructionDeps() {
  const stub: any = new Proxy(function () {}, {
    get: (_target, prop) => (prop === 'then' ? undefined : stub),
    apply: () => stub,
  });
  const noMw = (_req: any, _res: any, next: any) => next();
  const sessions = createSessionHelpers({
    config: {},
    stores: stub,
    getIO: () => null,
    resolveRequestToken: () => ({}),
    disconnectSocket: noMw,
    emitPresence: noMw,
    disconnectUserSockets: noMw,
    sendError: noMw,
    ErrorCodes: {},
  } as any);
  const own: any = { express, festivalAccess: sessions.festivalAccess, adminAuth: sessions.adminAuth };
  return new Proxy(own, { get: (target, prop) => (prop in target ? target[prop] : stub) });
}

type Row = { key: string; prefix: string; method: string; path: string; guarded: boolean; mountGuarded: boolean };

function listRows(): Row[] {
  const rows: Row[] = [];
  for (const { prefix, guards, router } of buildFestivalMounts(constructionDeps())) {
    for (const layer of router.stack) {
      assert.ok(layer.route, `${prefix}: a non-route layer in a festival router has no matrix row. Add the route as a route.`);
      const handles = layer.route.stack.map((l: any) => l.handle);
      for (const method of Object.keys(layer.route.methods)) {
        rows.push({
          key: `${method.toUpperCase()} ${prefix}${layer.route.path}`,
          prefix,
          method,
          path: layer.route.path,
          guarded: handles.some((fn: any) => typeof fn.action === 'string' && fn.param && new RegExp(`:${fn.param}(?!\w)`).test(layer.route.path)),
          mountGuarded: guards.length > 0,
        });
      }
    }
  }
  return rows;
}

// Reviewed by hand. A route here has no festival id to guard, or serves published data to anyone.
const REVIEWED_PUBLIC_OR_USER: Record<string, string> = {
  'GET /api/v1/festivals/': 'public list, published only; the admin list is a separate cache',
  'GET /api/v1/festivals/locate-set/:setId': 'public lookup of a published set',
  'GET /api/v1/festivals/:id/basemap': 'public read through visible(): published, or admin',
  'GET /api/v1/festivals/:id': 'public read through visible(): published, or admin',
  'GET /api/v1/festivals/follows': 'userAuth: the caller own follows',
  'PUT /api/v1/festivals/:id/follow': 'userAuth: the caller follows a festival',
  'DELETE /api/v1/festivals/:id/follow': 'userAuth: the caller unfollows a festival',
  'GET /api/v1/festivals/:festivalId/sets/:setId/also-picked': 'public aggregate for a published festival',
  'GET /api/v1/festivals/:id/announcements': 'public: sent announcements of a published festival',
};
// Inline adminAuth on a route with no festival id: it creates or lists across festivals.
const REVIEWED_ADMIN_NO_ID: Record<string, string> = {
  'POST /api/v1/festivals/': 'create has no festival id yet',
  'GET /api/v1/festivals/archived': 'cross-festival list',
};

describe('festival access: route inventory', () => {
  const rows = listRows();

  test('every festival route is guarded, mount-guarded or reviewed', () => {
    const problems: string[] = [];
    for (const row of rows) {
      const reviewed = REVIEWED_PUBLIC_OR_USER[row.key] ?? REVIEWED_ADMIN_NO_ID[row.key];
      const covered = row.guarded || row.mountGuarded || reviewed;
      if (!covered) problems.push(`${row.key}: no festivalAccess with a matching param, no mount adminAuth and no reviewed entry.`);
      if (row.guarded && reviewed) problems.push(`${row.key}: guarded, so remove it from the reviewed lists.`);
    }
    const keys = new Set(rows.map((r) => r.key));
    for (const key of [...Object.keys(REVIEWED_PUBLIC_OR_USER), ...Object.keys(REVIEWED_ADMIN_NO_ID)]) {
      if (!keys.has(key)) problems.push(`Reviewed entry '${key}' matches no route. Remove it.`);
    }
    assert.deepEqual(problems, []);
  });

  test('every action in the map is used by a route, and every route action is in the map', () => {
    const used = new Set<string>();
    for (const { router } of buildFestivalMounts(constructionDeps())) {
      for (const layer of router.stack) {
        for (const l of layer.route.stack) if (typeof l.handle.action === 'string') used.add(l.handle.action);
      }
    }
    assert.deepEqual([...used].sort(), Object.keys(FESTIVAL_ACTIONS).sort());
  });

  test('server.ts mounts the festival routers only through buildFestivalMounts', () => {
    const src = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    assert.match(src, /buildFestivalMounts\(deps\)/);
    assert.doesNotMatch(src, /createFestivalRoutes|createLineupImportRoutes|createLineupAnnounceRoutes|createAdminSiteplanRoutes|createAdminAnnouncementRoutes|createPublicAnnouncementRoutes|createFestivalDiscoveryRoutes/);
  });
});

describe('festival access: the guard', () => {
  function build({ session = true, admin = false } = {}) {
    const helpers = createSessionHelpers({
      config: { USER_SESSION_COOKIE: 'c', SESSION_TTL: 1 },
      stores: {
        sessions: { validateUserSession: async () => (session ? { userId: 'u1' } : null) },
        roles: { hasRole: async (userId: string, role: string) => admin && userId === 'u1' && role === 'admin' },
      },
      getIO: () => null,
      resolveRequestToken: () => ({ token: 't'.repeat(64), source: 'header' }),
      disconnectSocket() {},
      emitPresence() {},
      disconnectUserSockets() {},
      sendError: (res: any, status: number, message: string, code: string) => {
        res.statusCode = status;
        res.body = { message, code };
        return res;
      },
      ErrorCodes: { AUTH_REQUIRED: 'AUTH_REQUIRED', FORBIDDEN: 'FORBIDDEN' },
    } as any);
    return helpers;
  }
  const run = async (guard: any, req: any) => {
    const res: any = { headers: {} as any, setHeader(k: string, v: string) { this.headers[k] = v; } };
    let nexted = false;
    await guard(req, res, () => { nexted = true; });
    return { res, nexted };
  };

  test('an unknown action is refused at build time', () => {
    assert.throws(() => build().festivalAccess({ action: 'festival.fly' as any }), /Unknown festival action/);
  });

  test('no session is 401', async () => {
    const { res, nexted } = await run(build({ session: false }).festivalAccess({ action: 'festival.edit' }), { params: { id: 'f1' } });
    assert.equal(res.statusCode, 401);
    assert.equal(nexted, false);
  });

  test('a non-admin is 403 on every request until organizer access arrives', async () => {
    const guard = build().festivalAccess({ action: 'festival.edit' });
    const req: any = { params: { id: 'f1' } };
    const { res, nexted } = await run(guard, req);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, 'Admin access required');
    assert.equal(nexted, false);
    assert.equal(req.festivalId, undefined);
  });

  test('an admin passes, and the guard sets the festival id from the named param', async () => {
    const helpers = build({ admin: true });
    const byId: any = { params: { id: 'f1' } };
    const first = await run(helpers.festivalAccess({ action: 'festival.edit' }), byId);
    assert.equal(first.nexted, true);
    assert.equal(byId.festivalId, 'f1');
    assert.equal(byId.festivalRole, 'admin');
    assert.equal(byId.isAdmin, true);
    assert.equal(first.res.headers.Vary, 'Cookie');
    const byName: any = { params: { festivalId: 'f2' } };
    const guard = helpers.festivalAccess({ action: 'links.edit', param: 'festivalId' });
    await run(guard, byName);
    assert.equal(byName.festivalId, 'f2');
    assert.equal((guard as any).action, 'links.edit');
    assert.equal((guard as any).param, 'festivalId');
  });

  test('an admin request with an invalid festival id passes but leaves festivalId unset', async () => {
    const req: any = { params: { id: 'a b/../c' } };
    const { nexted } = await run(build({ admin: true }).festivalAccess({ action: 'festival.edit' }), req);
    assert.equal(nexted, true);
    assert.equal(req.festivalId, undefined);
  });
});

// Status codes of [anonymous, signed-in non-admin, admin], recorded on the base commit before festivalAccess
// replaced the inline adminAuth. Calls use a festival id that does not exist and an empty JSON body.
const BASELINE: Record<string, [number, number, number]> = {
  'POST /api/v1/admin/festivals/:id/siteplan-image': [401, 403, 404],
  'GET /api/v1/admin/festivals/': [401, 403, 200],
  'GET /api/v1/admin/festivals/locate-set/:setId': [401, 403, 404],
  'GET /api/v1/admin/festivals/archived': [401, 403, 200],
  'GET /api/v1/admin/festivals/:id/basemap': [401, 403, 404],
  'GET /api/v1/admin/festivals/:id': [401, 403, 404],
  'POST /api/v1/admin/festivals/': [401, 403, 400],
  'PUT /api/v1/admin/festivals/:id': [401, 403, 400],
  'GET /api/v1/admin/festivals/:id/impact': [401, 403, 404],
  'GET /api/v1/admin/festivals/:id/days-announcement': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/days-announcement': [401, 403, 404],
  'GET /api/v1/admin/festivals/:id/time-releases': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/time-releases': [401, 403, 400],
  'GET /api/v1/admin/festivals/:id/lineup-interest': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/publish': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/restore': [401, 403, 404],
  'DELETE /api/v1/admin/festivals/:id': [401, 403, 403],
  'PUT /api/v1/admin/festivals/:festivalId/sets/:setId/link': [401, 403, 404],
  'GET /api/v1/admin/festivals/:festivalId/sets/links': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/import-lineup/preview': [401, 403, 400],
  'POST /api/v1/admin/festivals/:id/import-lineup': [401, 403, 400],
  'GET /api/v1/admin/festivals/:id/imports': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/imports/:importId/undo': [401, 403, 404],
  'GET /api/v1/admin/festivals/:id/lineup-announcement': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/lineup-announcement': [401, 403, 404],
  'GET /api/v1/festivals/follows': [401, 200, 200],
  'PUT /api/v1/festivals/:id/follow': [401, 404, 404],
  'DELETE /api/v1/festivals/:id/follow': [401, 200, 200],
  'GET /api/v1/festivals/:festivalId/sets/:setId/also-picked': [404, 404, 404],
  'GET /api/v1/admin/festivals/:id/announcements': [401, 403, 404],
  'POST /api/v1/admin/festivals/:id/announcements': [401, 403, 400],
  'DELETE /api/v1/admin/festivals/:id/announcements/:announcementId': [401, 403, 404],
  'GET /api/v1/festivals/:id/announcements': [200, 200, 200],
  'GET /api/v1/festivals/': [200, 200, 200],
  'GET /api/v1/festivals/locate-set/:setId': [404, 404, 404],
  'GET /api/v1/festivals/archived': [401, 403, 200],
  'GET /api/v1/festivals/:id/basemap': [404, 404, 404],
  'GET /api/v1/festivals/:id': [404, 404, 404],
  'POST /api/v1/festivals/': [401, 403, 400],
  'PUT /api/v1/festivals/:id': [401, 403, 400],
  'GET /api/v1/festivals/:id/impact': [401, 403, 404],
  'POST /api/v1/festivals/:id/publish': [401, 403, 404],
  'POST /api/v1/festivals/:id/restore': [401, 403, 404],
  'DELETE /api/v1/festivals/:id': [401, 403, 403],
  'PUT /api/v1/festivals/:festivalId/sets/:setId/link': [401, 403, 404],
  'GET /api/v1/festivals/:festivalId/sets/links': [401, 403, 404],
};

describe('festival access: every route through the real app', { skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });
  after(() => {
    if (skip) console.log('festival-access-matrix: database half skipped (TEST_DATABASE_URL not set)');
  });

  const fill = (path: string) => path.replace(/:(\w+)/g, (_m, name) => (name === 'id' || name === 'festivalId' ? 'no-such-fest' : 'x1'));

  test('anonymous, signed-in non-admin and admin get the baseline status; non-admins never reach a handler', async () => {
    const server = await h.startServer();
    servers.push(server);
    const adminToken = await h.loginAdmin(server);
    const strangerName = `stranger-${Date.now()}`;
    await h.registerUser(server, strangerName);
    const strangerToken = (await h.loginUser(server, strangerName)).token;
    assert.ok(strangerToken, 'stranger session token');

    const call = (row: Row, token?: string) => {
      const url = `${row.prefix}${fill(row.path)}`;
      let req = (server.request as any)[row.method](url).set(h.TRUSTED_MUTATION_HEADER, '1');
      if (token) req = req.set('x-user-token', token);
      return ['get', 'delete'].includes(row.method) ? req : req.send({});
    };

    const rows = listRows();
    const got: Record<string, [number, number, number]> = {};
    const problems: string[] = [];
    for (const row of rows) {
      const anon = await call(row);
      const stranger = await call(row, strangerToken);
      const admin = await call(row, adminToken);
      got[row.key] = [anon.status, stranger.status, admin.status];
      if (row.guarded || row.mountGuarded || REVIEWED_ADMIN_NO_ID[row.key]) {
        if (anon.status !== 401) problems.push(`${row.key}: anonymous got ${anon.status}, want 401`);
        if (stranger.status !== 403) problems.push(`${row.key}: a signed-in non-admin got ${stranger.status}, want 403`);
        if (stranger.body?.error?.message !== 'Admin access required') problems.push(`${row.key}: non-admin 403 is not the admin gate answer`);
        if (admin.body?.error?.message === 'Admin access required') problems.push(`${row.key}: admin was refused`);
      }
    }
    if (process.env.MATRIX_DUMP) writeFileSync(process.env.MATRIX_DUMP, JSON.stringify(got, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual(got, BASELINE);
  });
});
