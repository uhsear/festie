import 'dotenv/config';
/**
 * Access matrix for every festival route (OP-1.1).
 *
 * buildFestivalMounts() is the one list of mounts server.ts uses. This test reads each router's own
 * stack and requires every route to carry festivalAccess, to sit behind a mount-level adminAuth, or to
 * appear in a reviewed list. It then calls every route through the real app as an anonymous caller,
 * a signed-in non-admin and an admin, and compares the status codes to a baseline recorded on the
 * branch before festivalAccess replaced the inline adminAuth. The /manage mount (routes/manage.ts) has no
 * routes of its own to read: its rows come from MANAGE_WHITELIST, resolved to the routes it forwards to.
 * The last describe adds the organization cells: a member of organization A against a festival of A, of B,
 * an admin-only festival, on and off the /manage mount, with the flag on and off.
 *
 * The first describes run without a database. The others need TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { after, afterEach, describe, test } from 'node:test';
import express from 'express';
import { createSessionHelpers, FESTIVAL_ACTIONS, ORG_ACTIONS, verifiedOrganizationOnly } from '../lib/app-context/session';
import { buildFestivalMounts } from '../lib/festival-mounts';
import { MANAGE_WHITELIST } from '../routes/manage';
import { TEST_DATABASE_URL, skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

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
  const config: any = new Proxy({ ORGANIZER_PLATFORM_ENABLED: true }, { get: (target: any, prop) => (prop in target ? target[prop] : stub) });
  const own: any = { express, config, festivalAccess: sessions.festivalAccess, orgAccess: sessions.orgAccess, adminAuth: sessions.adminAuth };
  return new Proxy(own, { get: (target, prop) => (prop in target ? target[prop] : stub) });
}

type Row = { key: string; prefix: string; method: string; path: string; guarded: boolean; mountGuarded: boolean; manage: boolean };

const guardsFestival = (handles: any[], path: string) =>
  handles.some(
    (fn: any) =>
      typeof fn.orgAction === 'string' ||
      (typeof fn.action === 'string' && fn.param && new RegExp(`:${fn.param}(?!\\w)`).test(path)),
  );

// The route layer of a forwarded router that a whitelist entry points at, or undefined for a stale entry.
function forwardedRoute(mount: any, entry: (typeof MANAGE_WHITELIST)[number]) {
  return mount.forwarded[entry.target].stack.find(
    (layer: any) => layer.route && layer.route.path === entry.path && layer.route.methods[entry.method.toLowerCase()],
  );
}

function listRows(): Row[] {
  const rows: Row[] = [];
  for (const mount of buildFestivalMounts(constructionDeps())) {
    const { prefix, guards, router } = mount;
    const manage = !!mount.forwarded;
    for (const layer of router.stack) {
      // The manage router's guards and forwards are not routes. Its rows are its own routes plus the whitelist.
      if (manage && !layer.route) continue;
      assert.ok(layer.route, `${prefix}: a non-route layer in a festival router has no matrix row. Add the route as a route.`);
      const handles = layer.route.stack.map((l: any) => l.handle);
      for (const method of Object.keys(layer.route.methods)) {
        rows.push({
          key: `${method.toUpperCase()} ${prefix}${layer.route.path}`,
          prefix,
          method,
          path: layer.route.path,
          guarded: guardsFestival(handles, layer.route.path),
          mountGuarded: !manage && guards.length > 0,
          manage,
        });
      }
    }
    if (!manage) continue;
    for (const entry of MANAGE_WHITELIST) {
      const target = forwardedRoute(mount, entry);
      assert.ok(target, `MANAGE_WHITELIST: ${entry.method} ${entry.mount}${entry.path} matches no route in the ${entry.target} router. Remove it.`);
      const path = entry.mount + entry.path;
      rows.push({
        key: `${entry.method} ${prefix}${path}`,
        prefix,
        method: entry.method.toLowerCase(),
        path,
        guarded: !!entry.guard || guardsFestival(target.route.stack.map((l: any) => l.handle), entry.path),
        mountGuarded: false,
        manage: true,
      });
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
  'GET /api/v1/manage/me': 'userAuth: the caller own organizations, plus the claim of the caller own pending memberships',
  'GET /api/v1/manage/festivals': 'userAuth: lists only festivals of the organizations the caller belongs to',
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
    for (const key of keys) {
      if (rows.filter((r) => r.key === key).length > 1) problems.push(`${key}: listed twice. A route must appear once per mount.`);
    }
    for (const key of [...Object.keys(REVIEWED_PUBLIC_OR_USER), ...Object.keys(REVIEWED_ADMIN_NO_ID)]) {
      if (!keys.has(key)) problems.push(`Reviewed entry '${key}' matches no route. Remove it.`);
    }
    assert.deepEqual(problems, []);
  });

  test('every action in the map is used by a route, and every route action is in the map', () => {
    const used = new Set<string>();
    const usedOrg = new Set<string>();
    for (const { router } of buildFestivalMounts(constructionDeps())) {
      for (const layer of router.stack) {
        for (const l of layer.route?.stack ?? []) {
          if (typeof l.handle.action === 'string') used.add(l.handle.action);
          if (typeof l.handle.orgAction === 'string') usedOrg.add(l.handle.orgAction);
        }
      }
    }
    for (const entry of MANAGE_WHITELIST) if (entry.guard) used.add(entry.guard);
    assert.deepEqual([...used].sort(), Object.keys(FESTIVAL_ACTIONS).sort());
    assert.deepEqual([...usedOrg].sort(), Object.keys(ORG_ACTIONS).sort());
  });

  test('the manage whitelist holds the plan routes and none of the admin-only ones', () => {
    const listed = MANAGE_WHITELIST.map((e) => `${e.method} ${e.mount}${e.path}`).sort();
    assert.deepEqual(listed, [
      'DELETE /festivals/:id',
      'DELETE /festivals/:id/announcements/:announcementId',
      'GET /festivals/:festivalId/sets/links',
      'GET /festivals/:id',
      'GET /festivals/:id/announcements',
      'GET /festivals/:id/impact',
      'GET /festivals/:id/imports',
      'GET /festivals/:id/lineup-announcement',
      'POST /festivals/:id/announcements',
      'POST /festivals/:id/import-lineup',
      'POST /festivals/:id/import-lineup/preview',
      'POST /festivals/:id/imports/:importId/undo',
      'POST /festivals/:id/lineup-announcement',
      'POST /festivals/:id/publish',
      'POST /festivals/:id/siteplan-image',
      'PUT /festivals/:festivalId/sets/:setId/link',
      'PUT /festivals/:id',
    ]);
    // listRows asserts that every entry resolves to a real route. Each must also carry a festivalAccess guard.
    const unguarded = listRows().filter((r) => r.manage && !r.guarded && !REVIEWED_PUBLIC_OR_USER[r.key]);
    assert.deepEqual(unguarded.map((r) => r.key), []);
  });

  test('the manage mount exists only while the flag is on', () => {
    const deps: any = constructionDeps();
    deps.config.ORGANIZER_PLATFORM_ENABLED = false;
    assert.equal(buildFestivalMounts(deps).some((m) => m.prefix === '/api/v1/manage'), false);
    assert.equal(buildFestivalMounts(constructionDeps()).some((m) => m.prefix === '/api/v1/manage'), true);
  });

  test('server.ts mounts the festival routers only through buildFestivalMounts', () => {
    const src = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
    assert.match(src, /buildFestivalMounts\(deps\)/);
    assert.doesNotMatch(src, /createFestivalRoutes|createLineupImportRoutes|createLineupAnnounceRoutes|createAdminSiteplanRoutes|createAdminAnnouncementRoutes|createPublicAnnouncementRoutes|createFestivalDiscoveryRoutes/);
  });
});

describe('festival access: the guard', () => {
  type Membership = { role: string; status: string; verified: boolean; name: string };
  function build({
    session = true,
    admin = false,
    flag = true,
    festivals = {} as Record<string, any>,
    memberships = {} as Record<string, Membership>,
  } = {}) {
    const helpers = createSessionHelpers({
      config: { USER_SESSION_COOKIE: 'c', SESSION_TTL: 1, ORGANIZER_PLATFORM_ENABLED: flag },
      stores: {
        sessions: { validateUserSession: async () => (session ? { userId: 'u1' } : null) },
        roles: { hasRole: async (userId: string, role: string) => admin && userId === 'u1' && role === 'admin' },
        // The member lookups the guard makes: one festival row, then one membership row by organization.
        organizations: {
          festivalAccessRow: async (id: string) => festivals[id] ?? null,
          membership: async (_userId: string, organizationId: string) => memberships[organizationId] ?? null,
          getById: async (id: string) => (id === 'org-a' ? { id } : null),
        },
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
      ErrorCodes: { AUTH_REQUIRED: 'AUTH_REQUIRED', FORBIDDEN: 'FORBIDDEN', NOT_FOUND: 'NOT_FOUND', INVALID_INPUT: 'INVALID_INPUT' },
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
    assert.throws(() => build().orgAccess({ action: 'festival.fly' as any }), /Unknown organization action/);
  });

  test('no session is 401', async () => {
    const { res, nexted } = await run(build({ session: false }).festivalAccess({ action: 'festival.edit' }), { params: { id: 'f1' } });
    assert.equal(res.statusCode, 401);
    assert.equal(nexted, false);
  });

  test('a non-admin is 403 off the manage mount, even as a member of the festival organization', async () => {
    const helpers = build({
      festivals: { f1: { id: 'f1', organizationId: 'org-a', publishedAt: null, deletedAt: null } },
      memberships: { 'org-a': { role: 'owner', status: 'active', verified: true, name: 'Org A' } },
    });
    const req: any = { params: { id: 'f1' } };
    const { res, nexted } = await run(helpers.festivalAccess({ action: 'festival.edit' }), req);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.message, 'Admin access required');
    assert.equal(nexted, false);
    assert.equal(req.festivalId, undefined);
  });

  test('an admin passes, and the guard sets the festival id from the named param', async () => {
    const helpers = build({ admin: true, festivals: { f1: { id: 'f1', organizationId: 'org-a', publishedAt: null } } });
    const byId: any = { params: { id: 'f1' } };
    const first = await run(helpers.festivalAccess({ action: 'festival.edit' }), byId);
    assert.equal(first.nexted, true);
    assert.equal(byId.festivalId, 'f1');
    assert.equal(byId.festivalRole, 'admin');
    assert.equal(byId.isAdmin, true);
    assert.equal(byId.organizationId, 'org-a', 'an admin action on an organization festival is audited with its organization');
    assert.equal(first.res.headers.Vary, 'Cookie');
    const byName: any = { params: { festivalId: 'f2' } };
    const guard = helpers.festivalAccess({ action: 'links.edit', param: 'festivalId' });
    await run(guard, byName);
    assert.equal(byName.festivalId, 'f2');
    assert.equal(byName.organizationId, null);
    assert.equal((guard as any).action, 'links.edit');
    assert.equal((guard as any).param, 'festivalId');
  });

  test('an admin request with an invalid festival id passes but leaves festivalId unset', async () => {
    const req: any = { params: { id: 'a b/../c' } };
    const { nexted } = await run(build({ admin: true }).festivalAccess({ action: 'festival.edit' }), req);
    assert.equal(nexted, true);
    assert.equal(req.festivalId, undefined);
  });

  describe('a member on the manage mount', () => {
    const festivals = {
      draft: { id: 'draft', organizationId: 'org-a', publishedAt: null, deletedAt: null },
      live: { id: 'live', organizationId: 'org-a', publishedAt: new Date(), deletedAt: null },
      gone: { id: 'gone', organizationId: 'org-a', publishedAt: null, deletedAt: new Date() },
      platform: { id: 'platform', organizationId: null, publishedAt: null, deletedAt: null },
      other: { id: 'other', organizationId: 'org-b', publishedAt: null, deletedAt: null },
    };
    const member = (role: string, status = 'active') => ({ 'org-a': { role, status, verified: false, name: 'Org A' } });
    const call = async (opts: any, action: any, id: string, extra: any = {}) => {
      const req: any = { organizerMount: true, params: { id }, user: { userId: 'u1' } };
      const out = await run(build({ festivals, ...opts }).festivalAccess({ action, ...extra }), req);
      return { ...out, req };
    };

    test('passes with the role of its membership, and the answer is never cached', async () => {
      const { nexted, res, req } = await call({ memberships: member('editor') }, 'festival.edit', 'draft');
      assert.equal(nexted, true);
      assert.equal(req.festivalRole, 'editor');
      assert.equal(req.organizationId, 'org-a');
      assert.equal(req.festivalId, 'draft');
      assert.equal(req.isAdmin, undefined);
      assert.equal(res.headers['Cache-Control'], 'private, no-store');
      assert.equal(res.headers.Vary, 'Cookie');
    });

    test('is refused when the flag is off, whatever the role', async () => {
      const { res, nexted } = await call({ memberships: member('owner'), flag: false }, 'festival.view', 'draft');
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.message, 'Admin access required');
      assert.equal(nexted, false);
    });

    test('sees 404 for a festival it is not a member of, a platform festival, a deleted one and a missing one', async () => {
      for (const id of ['other', 'platform', 'gone', 'missing']) {
        const { res, nexted } = await call({ memberships: member('owner') }, 'festival.view', id);
        assert.equal(res.statusCode, 404, id);
        assert.equal(nexted, false);
      }
    });

    test('is 400 for an invalid festival id, and 404 without a membership', async () => {
      assert.equal((await call({ memberships: member('owner') }, 'festival.view', 'a b/../c')).res.statusCode, 400);
      assert.equal((await call({ memberships: {} }, 'festival.view', 'draft')).res.statusCode, 404);
    });

    test('needs the role of the action: a viewer reads, an editor edits, only an owner sees impact and deletes', async () => {
      assert.equal((await call({ memberships: member('viewer') }, 'festival.view', 'draft')).nexted, true);
      assert.equal((await call({ memberships: member('viewer') }, 'lineup.history', 'draft')).nexted, true);
      assert.equal((await call({ memberships: member('viewer') }, 'festival.edit', 'draft')).res.statusCode, 403);
      assert.equal((await call({ memberships: member('editor') }, 'festival.edit', 'draft')).nexted, true);
      const impact = await call({ memberships: member('editor') }, 'festival.impact', 'draft');
      assert.equal(impact.res.statusCode, 403);
      assert.equal(impact.res.body.message, 'Only an owner of Org A can do this.');
      assert.equal((await call({ memberships: member('owner') }, 'festival.impact', 'draft')).nexted, true);
    });

    test('never passes an admin-only action', async () => {
      for (const action of ['publish.decide', 'festival.restore', 'lineup.drop', 'alert.release']) {
        const { res, nexted } = await call({ memberships: member('owner') }, action, 'draft');
        assert.equal(res.statusCode, 403, action);
        assert.equal(nexted, false, action);
      }
    });

    test('a verified-only route refuses an unverified owner and passes a verified one, an admin always passes', async () => {
      const refused = await call({ memberships: member('owner') }, 'lineup.announce', 'live', { allow: verifiedOrganizationOnly });
      assert.equal(refused.res.statusCode, 403);
      assert.match(refused.res.body.message, /not verified/);
      const verified = await call({ memberships: { 'org-a': { role: 'owner', status: 'active', verified: true, name: 'Org A' } } }, 'lineup.announce', 'live', { allow: verifiedOrganizationOnly });
      assert.equal(verified.nexted, true);
      assert.equal((await call({ memberships: member('editor') }, 'lineup.announce', 'live', { allow: verifiedOrganizationOnly })).res.statusCode, 403);
      assert.equal((await call({ admin: true }, 'lineup.announce', 'live', { allow: verifiedOrganizationOnly })).nexted, true);
    });

    test('suspended: reads pass, every write is 403', async () => {
      assert.equal((await call({ memberships: member('owner', 'suspended') }, 'festival.view', 'live')).nexted, true);
      const write = await call({ memberships: member('owner', 'suspended') }, 'festival.edit', 'draft');
      assert.equal(write.res.statusCode, 403);
      assert.match(write.res.body.message, /access is paused/);
    });

    test('pending: a draft is writable, a live festival and an upload are not', async () => {
      assert.equal((await call({ memberships: member('owner', 'pending') }, 'festival.edit', 'draft')).nexted, true);
      assert.equal((await call({ memberships: member('owner', 'pending') }, 'festival.edit', 'live')).res.statusCode, 403);
      assert.equal((await call({ memberships: member('owner', 'pending') }, 'map.edit', 'draft')).res.statusCode, 403);
      assert.equal((await call({ memberships: member('owner', 'pending') }, 'festival.view', 'live')).nexted, true);
    });

    test('a per-route allow rule can refuse, and it is not asked of an admin', async () => {
      const deny = () => ({ status: 403, code: 'FORBIDDEN' as const, message: 'Not this one.' });
      const refused = await call({ memberships: member('owner') }, 'festival.edit', 'draft', { allow: deny });
      assert.equal(refused.res.statusCode, 403);
      assert.equal(refused.res.body.message, 'Not this one.');
      const adminPass = await call({ admin: true }, 'festival.edit', 'draft', { allow: deny });
      assert.equal(adminPass.nexted, true);
    });
  });

  describe('orgAccess', () => {
    const member = (role: string, status = 'active') => ({ 'org-a': { role, status, verified: false, name: 'Org A' } });
    const callOrg = async (opts: any, body: any, organizerMount = true) => {
      const req: any = { organizerMount, body, user: { userId: 'u1' } };
      const out = await run(build(opts).orgAccess({ action: 'festival.create' }), req);
      return { ...out, req };
    };

    test('an owner passes for its own organization and the guard records it', async () => {
      const { nexted, req } = await callOrg({ memberships: member('owner') }, { organizationId: 'org-a' });
      assert.equal(nexted, true);
      assert.equal(req.organizationId, 'org-a');
      assert.equal(req.festivalRole, 'owner');
    });

    test('an editor is 403, a stranger is 404, a missing organization id is 400, suspended is 403', async () => {
      assert.equal((await callOrg({ memberships: member('editor') }, { organizationId: 'org-a' })).res.statusCode, 403);
      assert.equal((await callOrg({ memberships: {} }, { organizationId: 'org-a' })).res.statusCode, 404);
      assert.equal((await callOrg({ memberships: member('owner') }, {})).res.statusCode, 400);
      assert.equal((await callOrg({ memberships: member('owner', 'suspended') }, { organizationId: 'org-a' })).res.statusCode, 403);
      assert.equal((await callOrg({ memberships: member('owner', 'pending') }, { organizationId: 'org-a' })).nexted, true);
    });

    test('off the manage mount a non-admin is 403, and an admin needs the organization to exist', async () => {
      assert.equal((await callOrg({ memberships: member('owner') }, { organizationId: 'org-a' }, false)).res.statusCode, 403);
      assert.equal((await callOrg({ admin: true }, { organizationId: 'org-a' }, false)).nexted, true);
      assert.equal((await callOrg({ admin: true }, { organizationId: 'org-zzz' }, false)).res.statusCode, 404);
    });
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
  'POST /api/v1/admin/festivals/:id/publish/decline': [401, 403, 400],
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
  'POST /api/v1/festivals/:id/publish/decline': [401, 403, 400],
  'POST /api/v1/festivals/:id/restore': [401, 403, 404],
  'DELETE /api/v1/festivals/:id': [401, 403, 403],
  'PUT /api/v1/festivals/:festivalId/sets/:setId/link': [401, 403, 404],
  'GET /api/v1/festivals/:festivalId/sets/links': [401, 403, 404],
  // Organizations (admin only). A member change asks an admin for a recent password first.
  'POST /api/v1/admin/organizations/': [401, 403, 400],
  'GET /api/v1/admin/organizations/': [401, 403, 200],
  'GET /api/v1/admin/organizations/:id': [401, 403, 404],
  // The review queue: publish requests and held alerts. Release and discard name a festival.
  'GET /api/v1/admin/organizations/review-queue': [401, 403, 200],
  'POST /api/v1/admin/organizations/held-alerts/:festivalId/release': [401, 403, 404],
  'DELETE /api/v1/admin/organizations/held-alerts/:festivalId': [401, 403, 404],
  'PUT /api/v1/admin/organizations/:id/status': [401, 403, 400],
  'PUT /api/v1/admin/organizations/:id/verified': [401, 403, 400],
  'POST /api/v1/admin/organizations/:id/members': [401, 403, 403],
  'PUT /api/v1/admin/organizations/:id/members/:userId': [401, 403, 403],
  'DELETE /api/v1/admin/organizations/:id/members/:userId': [401, 403, 403],
  'DELETE /api/v1/admin/organizations/:id/pending-members/:email': [401, 403, 403],
  // The manage mount. A signed-in caller with no membership sees 404 where the admin mount says 403.
  'GET /api/v1/manage/me': [401, 200, 200],
  'GET /api/v1/manage/festivals': [401, 200, 200],
  'POST /api/v1/manage/festivals': [401, 400, 400],
  'GET /api/v1/manage/festivals/:id': [401, 404, 404],
  'PUT /api/v1/manage/festivals/:id': [401, 404, 400],
  'DELETE /api/v1/manage/festivals/:id': [401, 404, 403],
  'GET /api/v1/manage/festivals/:id/impact': [401, 404, 404],
  'POST /api/v1/manage/festivals/:id/import-lineup/preview': [401, 404, 400],
  'POST /api/v1/manage/festivals/:id/import-lineup': [401, 404, 400],
  'GET /api/v1/manage/festivals/:id/imports': [401, 404, 404],
  'POST /api/v1/manage/festivals/:id/imports/:importId/undo': [401, 404, 404],
  'PUT /api/v1/manage/festivals/:festivalId/sets/:setId/link': [401, 404, 404],
  'GET /api/v1/manage/festivals/:festivalId/sets/links': [401, 404, 404],
  'POST /api/v1/manage/festivals/:id/siteplan-image': [401, 404, 404],
  'POST /api/v1/manage/festivals/:id/publish-request': [401, 404, 404],
  'DELETE /api/v1/manage/festivals/:id/publish-request': [401, 404, 404],
  'GET /api/v1/manage/organizations/:id': [401, 404, 404],
  'PUT /api/v1/manage/organizations/:id': [401, 404, 404],
  'POST /api/v1/manage/organizations/:id/members': [401, 404, 404],
  'PUT /api/v1/manage/organizations/:id/members/:userId': [401, 404, 404],
  'DELETE /api/v1/manage/organizations/:id/members/:userId': [401, 404, 404],
  'DELETE /api/v1/manage/organizations/:id/pending-members/:email': [401, 404, 404],
  'POST /api/v1/manage/festivals/:id/publish': [401, 404, 404],
  // Phase 3: banners for every organization, the lineup drop and the interest counts for a verified one, the audit view.
  'GET /api/v1/manage/festivals/:id/engagement': [401, 404, 404],
  'GET /api/v1/manage/festivals/:id/announcements': [401, 404, 404],
  'POST /api/v1/manage/festivals/:id/announcements': [401, 404, 400],
  'DELETE /api/v1/manage/festivals/:id/announcements/:announcementId': [401, 404, 404],
  'GET /api/v1/manage/festivals/:id/lineup-announcement': [401, 404, 404],
  'POST /api/v1/manage/festivals/:id/lineup-announcement': [401, 404, 404],
  'GET /api/v1/manage/organizations/:id/audit': [401, 404, 404],
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
        if (row.manage) {
          // A create names its organization in the body, so a stranger who sends none gets a 400, not a 404.
          const want = row.key === 'POST /api/v1/manage/festivals' ? 400 : 404;
          if (stranger.status !== want) problems.push(`${row.key}: a signed-in non-member got ${stranger.status}, want ${want}`);
        } else {
          if (stranger.status !== 403) problems.push(`${row.key}: a signed-in non-admin got ${stranger.status}, want 403`);
          if (stranger.body?.error?.message !== 'Admin access required') problems.push(`${row.key}: non-admin 403 is not the admin gate answer`);
        }
        if (admin.body?.error?.message === 'Admin access required') problems.push(`${row.key}: admin was refused`);
      }
    }
    if (process.env.MATRIX_DUMP) writeFileSync(process.env.MATRIX_DUMP, JSON.stringify(got, null, 1));
    assert.deepEqual(problems, []);
    assert.deepEqual(got, BASELINE);
  });
});

// ── Organization cells ───────────────────────────────────────────────────
// Members of organization A against a festival of A, of B, an admin-only festival (organization NULL), a
// festival of a suspended and of a pending organization. The /manage mount grants the role; every other
// mount keeps today's admin-only answer. Statuses are the whole contract, so they are pinned.
describe('festival access: organization cells', { skip }, () => {
  const servers: any[] = [];
  afterEach(async () => {
    while (servers.length > 0) await servers.pop().close();
  });

  const MANAGE = '/api/v1/manage/festivals';
  const ARTISTS = '/api/v1/manage/artists';
  const ADMIN_ARTISTS = '/api/v1/admin/artists';

  async function boot(overrides: Record<string, any> = {}) {
    const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000, ...overrides });
    servers.push(server);
    const users = await o.seedScenario(server);
    const adminToken = await h.loginAdmin(server);
    return { server, users, adminToken };
  }

  // [who, request, expected status]. `who` is a key of the scenario users, 'admin' or 'anon'.
  type Cell = [string, string, number];

  async function runCells(server: any, tokens: Record<string, string | undefined>, cells: Cell[], withBody: (url: string) => unknown = () => ({})) {
    const problems: string[] = [];
    for (const [who, request, want] of cells) {
      const [method, url] = request.split(' ') as [string, string];
      const caller = o.as(server, tokens[who]);
      const res = await (method === 'GET' || method === 'DELETE' ? caller[method.toLowerCase()](url) : caller[method.toLowerCase()](url, withBody(url)));
      if (res.status !== want) problems.push(`${who} ${request}: got ${res.status}, want ${want} (${res.body?.error?.message ?? ''})`);
    }
    return problems;
  }

  const tokensOf = (users: any, adminToken: string) => ({
    ...Object.fromEntries(Object.entries(users).map(([name, user]: any) => [name, user.token])),
    admin: adminToken,
    anon: undefined,
  });

  test('reads on the manage mount: members of A see A, nobody sees B, the platform festival or a missing one', async () => {
    const { server, users, adminToken } = await boot();
    const cells: Cell[] = [];
    for (const who of ['viewerA', 'editorA', 'ownerA']) {
      cells.push([who, `GET ${MANAGE}/f-a`, 200], [who, `GET ${MANAGE}/f-a-live`, 200]);
      cells.push([who, `GET ${MANAGE}/f-b`, 404], [who, `GET ${MANAGE}/f-plat`, 404], [who, `GET ${MANAGE}/f-s`, 404], [who, `GET ${MANAGE}/nope`, 404]);
    }
    cells.push(['ownerB', `GET ${MANAGE}/f-a`, 404], ['ownerB', `GET ${MANAGE}/f-b`, 200]);
    cells.push(['stranger', `GET ${MANAGE}/f-a`, 404], ['stranger', `GET ${MANAGE}/f-a-live`, 404]);
    cells.push(['unconfirmed', `GET ${MANAGE}/f-a`, 404]);
    cells.push(['anon', `GET ${MANAGE}/f-a`, 401]);
    cells.push(['admin', `GET ${MANAGE}/f-a`, 200], ['admin', `GET ${MANAGE}/f-plat`, 200], ['admin', `GET ${MANAGE}/f-b`, 200]);
    // A suspended organization still reads. A pending one reads its live festival too.
    cells.push(['ownerS', `GET ${MANAGE}/f-s`, 200], ['ownerS', `GET ${MANAGE}/f-s-live`, 200], ['ownerP', `GET ${MANAGE}/f-p-live`, 200]);
    assert.deepEqual(await runCells(server, tokensOf(users, adminToken), cells), []);
  });

  test('a soft-deleted user keeps no access even with a session left over', async () => {
    const { server, users } = await boot();
    const res = await o.as(server, users.ghostA.token).get(`${MANAGE}/f-a`);
    assert.ok([401, 404].includes(res.status), `deleted user got ${res.status}`);
    assert.equal((await o.as(server, users.ghostA.token).put(`${MANAGE}/f-a`, { name: 'x' })).status === 200, false);
  });

  test('writes on the manage mount: roles, tenants, organization status and the per-route rules', async () => {
    const { server, users, adminToken } = await boot();
    const cells: Cell[] = [
      ['viewerA', `PUT ${MANAGE}/f-a`, 403],
      ['editorA', `PUT ${MANAGE}/f-a`, 200],
      ['ownerA', `PUT ${MANAGE}/f-a`, 200],
      // A live festival's name is Festie's until the organization is verified (the body below renames it).
      ['ownerA', `PUT ${MANAGE}/f-a-live`, 403],
      ['ownerA', `PUT ${MANAGE}/f-b`, 404],
      ['ownerA', `PUT ${MANAGE}/f-plat`, 404],
      ['ownerB', `PUT ${MANAGE}/f-a`, 404],
      ['stranger', `PUT ${MANAGE}/f-a`, 404],
      ['unconfirmed', `PUT ${MANAGE}/f-a`, 404],
      ['anon', `PUT ${MANAGE}/f-a`, 401],
      // Suspended: no write at all. Pending: a draft only.
      ['ownerS', `PUT ${MANAGE}/f-s`, 403],
      ['ownerS', `PUT ${MANAGE}/f-s-live`, 403],
      ['ownerP', `PUT ${MANAGE}/f-p`, 200],
      ['ownerP', `PUT ${MANAGE}/f-p-live`, 403],
      // Impact is an owner read.
      ['ownerA', `GET ${MANAGE}/f-a/impact`, 200],
      ['editorA', `GET ${MANAGE}/f-a/impact`, 403],
      ['viewerA', `GET ${MANAGE}/f-a/impact`, 403],
      ['ownerB', `GET ${MANAGE}/f-a/impact`, 404],
      // Lineup import: editors import, viewers only read the history.
      ['viewerA', `POST ${MANAGE}/f-a/import-lineup`, 403],
      ['viewerA', `GET ${MANAGE}/f-a/imports`, 200],
      ['ownerB', `GET ${MANAGE}/f-a/imports`, 404],
      ['ownerB', `POST ${MANAGE}/f-a/import-lineup/preview`, 404],
      ['editorA', `POST ${MANAGE}/f-a/imports/x1/undo`, 404],
      // Links and the site plan.
      ['viewerA', `PUT ${MANAGE}/f-a/sets/x1/link`, 403],
      ['ownerB', `PUT ${MANAGE}/f-a/sets/x1/link`, 404],
      ['ownerB', `GET ${MANAGE}/f-a/sets/links`, 404],
      ['ownerB', `POST ${MANAGE}/f-a/siteplan-image`, 404],
      ['viewerA', `POST ${MANAGE}/f-a/siteplan-image`, 403],
      ['ownerP', `POST ${MANAGE}/f-p/siteplan-image`, 403],
    ];
    // A member's save names the version it started from. A far-future token is never stale.
    const body = (url: string) =>
      url.endsWith('/import-lineup') || url.endsWith('/preview') ? { rows: [] } : { name: 'Renamed', expectedUpdatedAt: '2999-01-01T00:00:00Z' };
    assert.deepEqual(await runCells(server, tokensOf(users, adminToken), cells, body), []);
  });

  // The viewer role is read only on the API: every write row of the manage mount refuses a viewer, whatever the
  // body, and an editor is refused the owner rows. The reads of the same rows stay open to a viewer.
  test('a viewer is read only: every write row of the manage mount is 403, the reads stay open', async () => {
    const { server, users } = await boot();
    const ORGS = '/api/v1/manage/organizations/org-a';
    const writes: Array<[string, unknown]> = [
      [`PUT ${MANAGE}/f-a`, { name: 'x', expectedUpdatedAt: '2999-01-01T00:00:00Z' }],
      [`DELETE ${MANAGE}/f-a`, {}],
      [`POST ${MANAGE}`, { organizationId: 'org-a', name: 'x' }],
      [`POST ${MANAGE}/f-a/publish-request`, {}],
      [`DELETE ${MANAGE}/f-a/publish-request`, {}],
      [`POST ${MANAGE}/f-a/publish`, {}],
      [`POST ${MANAGE}/f-a/import-lineup/preview`, { rows: [] }],
      [`POST ${MANAGE}/f-a/import-lineup`, { rows: [] }],
      [`POST ${MANAGE}/f-a/imports/x1/undo`, {}],
      [`PUT ${MANAGE}/f-a/sets/x1/link`, {}],
      [`POST ${MANAGE}/f-a/siteplan-image`, {}],
      [`PUT ${ORGS}`, { name: 'Renamed' }],
      [`POST ${ORGS}/members`, { email: 'x@example.com', role: 'viewer' }],
      [`PUT ${ORGS}/members/${users.editorA.id}`, { role: 'viewer' }],
      [`DELETE ${ORGS}/members/${users.editorA.id}`, {}],
      [`DELETE ${ORGS}/pending-members/x@example.com`, {}],
      [`POST ${ARTISTS}`, { name: 'Viewer Artist' }],
    ];
    const problems: string[] = [];
    for (const [request, body] of writes) {
      const [method, url] = request.split(' ') as [string, string];
      const caller = o.as(server, users.viewerA.token);
      const res = await (method === 'DELETE' ? caller.delete(url) : (caller as any)[method.toLowerCase()](url, body));
      if (res.status !== 403) problems.push(`viewerA ${request}: got ${res.status}, want 403 (${res.body?.error?.message ?? ''})`);
    }
    // Owner-only rows are also closed to an editor.
    for (const request of [`PUT ${ORGS}`, `POST ${ORGS}/members`, `DELETE ${ORGS}/members/${users.viewerA.id}`, `DELETE ${MANAGE}/f-a`, `GET ${MANAGE}/f-a/impact`]) {
      const [method, url] = request.split(' ') as [string, string];
      const caller = o.as(server, users.editorA.token);
      const res = await (method === 'GET' || method === 'DELETE' ? (caller as any)[method.toLowerCase()](url) : (caller as any)[method.toLowerCase()](url, { name: 'x', email: 'x@example.com', role: 'viewer' }));
      if (res.status !== 403) problems.push(`editorA ${request}: got ${res.status}, want 403`);
    }
    assert.deepEqual(problems, []);

    const reads: Cell[] = [
      ['viewerA', `GET ${MANAGE}/f-a`, 200],
      ['viewerA', `GET ${MANAGE}/f-a/imports`, 200],
      ['viewerA', `GET ${MANAGE}`, 200],
      ['viewerA', `GET ${ORGS}`, 200],
      ['viewerA', 'GET /api/v1/manage/me', 200],
      ['viewerA', `GET ${ARTISTS}?q=a`, 200],
      ['viewerA', 'GET /api/v1/manage/organizations/org-b', 404],
    ];
    assert.deepEqual(await runCells(server, tokensOf(users, ''), reads), []);
  });

  test('dropping picked sets, live delete and hard delete are not organizer decisions', async () => {
    const { server, users } = await boot();
    const editor = await o.as(server, users.editorA.token).put(`${MANAGE}/f-a`, { name: 'x', confirmRemovals: true, expectedUpdatedAt: '2999-01-01T00:00:00Z' });
    assert.equal(editor.status, 403);
    assert.match(editor.body.error.message, /An owner of Org org-a must confirm the removal/);

    await o.reauth(server, users.ownerA.token);
    const live = await o.as(server, users.ownerA.token).delete(`${MANAGE}/f-a-live`);
    assert.equal(live.status, 403);
    assert.match(live.body.error.message, /live/);
    const hard = await o.as(server, users.ownerA.token).delete(`${MANAGE}/f-a?hard=true`);
    assert.equal(hard.status, 403);
    assert.match(hard.body.error.message, /permanently/);
    const editorDelete = await o.as(server, users.editorA.token).delete(`${MANAGE}/f-a`);
    assert.equal(editorDelete.status, 403);
    assert.match(editorDelete.body.error.message, /Only an owner of Org org-a/);
    const stillThere = await o.sql(server, 'SELECT deleted_at FROM festivals WHERE id = ANY($1)', [['f-a', 'f-a-live']]);
    assert.deepEqual(stillThere.rows.map((r: any) => r.deleted_at), [null, null]);

    // An owner may soft-delete a draft, once a recent password is on record.
    const draft = await o.as(server, users.ownerA.token).delete(`${MANAGE}/f-a`);
    assert.equal(draft.status, 200);
    assert.equal(draft.body.data.softDeleted, true);
    assert.equal((await o.as(server, users.ownerA.token).get(`${MANAGE}/f-a`)).status, 404);
    assert.equal((await o.as(server, users.ownerB.token).delete(`${MANAGE}/f-a`)).status, 404);
  });

  test('delete asks a member for a recent password, as it asks an admin', async () => {
    const { server, users } = await boot();
    const res = await o.as(server, users.ownerA.token).delete(`${MANAGE}/f-a`);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'REAUTH_REQUIRED');
  });

  test('creating a festival: owners only, own organization only, server-made id, caps, no cross-tenant create', async () => {
    const { server, users } = await boot();
    const created = await o.as(server, users.ownerA.token).post(MANAGE, { organizationId: 'org-a', name: 'New Fest', id: 'client-chosen-id' });
    assert.equal(created.status, 201);
    assert.notEqual(created.body.data.id, 'client-chosen-id');
    assert.match(created.body.data.id, /^fest-[0-9a-f-]{36}$/);
    const row = (await o.sql(server, 'SELECT organization_id, created_by, published_at FROM festivals WHERE id = $1', [created.body.data.id])).rows[0];
    assert.equal(row.organization_id, 'org-a');
    assert.equal(row.created_by, users.ownerA.id);
    assert.equal(row.published_at, null);

    const cells: Cell[] = [
      ['editorA', 'POST ' + MANAGE, 403],
      ['viewerA', 'POST ' + MANAGE, 403],
      ['ownerB', 'POST ' + MANAGE, 404],
      ['stranger', 'POST ' + MANAGE, 404],
      ['unconfirmed', 'POST ' + MANAGE, 404],
      ['anon', 'POST ' + MANAGE, 401],
    ];
    assert.deepEqual(await runCells(server, tokensOf(users, ''), cells, () => ({ organizationId: 'org-a', name: 'Other' })), []);
    const suspended = await o.as(server, users.ownerS.token).post(MANAGE, { organizationId: 'org-s', name: 'Other' });
    assert.equal(suspended.status, 403);
    assert.match(suspended.body.error.message, /access is paused/);

    // Pending: two drafts at most (f-p is the first), then the cap answers 403.
    const second = await o.as(server, users.ownerP.token).post(MANAGE, { organizationId: 'org-p', name: 'Second' });
    assert.equal(second.status, 201);
    const third = await o.as(server, users.ownerP.token).post(MANAGE, { organizationId: 'org-p', name: 'Third' });
    assert.equal(third.status, 403);
    assert.match(third.body.error.message, /2 drafts/);
  });

  test('the list is the caller own organizations only, drafts and deleted ones included, never the shared cache', async () => {
    const { server, users, adminToken } = await boot();
    await o.sql(server, 'UPDATE festivals SET deleted_at = NOW() WHERE id = $1', ['f-a-live']);
    const own = await o.as(server, users.editorA.token).get(MANAGE);
    assert.equal(own.status, 200);
    const items = own.body.data;
    assert.deepEqual(items.map((f: any) => f.id).sort(), ['f-a', 'f-a-live']);
    assert.equal(items.find((f: any) => f.id === 'f-a-live').deleted, true);
    assert.equal(items.find((f: any) => f.id === 'f-a').published, false);
    for (const [who, expected] of [['ownerB', ['f-b']], ['stranger', []], ['unconfirmed', []]] as const) {
      const res = await o.as(server, (users as any)[who].token).get(MANAGE);
      assert.deepEqual(res.body.data.map((f: any) => f.id), expected, who);
    }
    // The organizer never fills or reads the admin list cache through this mount.
    assert.equal((await o.as(server, users.ownerA.token).get('/api/v1/admin/festivals')).status, 403);
    const adminList = await o.as(server, adminToken).get('/api/v1/admin/festivals');
    assert.ok(adminList.body.data.some((f: any) => f.id === 'f-b'), 'the admin list is unchanged');
  });

  test('on every other mount a member gets today\'s admin-only answer', async () => {
    const { server, users } = await boot();
    const cells: Cell[] = [];
    for (const who of ['viewerA', 'editorA', 'ownerA']) {
      cells.push(
        [who, 'PUT /api/v1/festivals/f-a', 403],
        [who, 'PUT /api/v1/admin/festivals/f-a', 403],
        [who, 'DELETE /api/v1/festivals/f-a', 403],
        [who, 'GET /api/v1/festivals/f-a/impact', 403],
        [who, 'PUT /api/v1/festivals/f-a/sets/x1/link', 403],
        [who, 'GET /api/v1/festivals/f-a/sets/links', 403],
        [who, 'POST /api/v1/admin/festivals/f-a/import-lineup', 403],
        [who, 'POST /api/v1/admin/festivals/f-a/siteplan-image', 403],
        [who, 'POST /api/v1/admin/festivals/f-a/publish', 403],
        [who, 'POST /api/v1/festivals', 403],
        [who, 'GET /api/v1/admin/festivals/archived', 403],
        [who, 'GET /api/v1/festivals/archived', 403],
        [who, 'GET /api/v1/admin/festivals', 403],
        [who, 'GET /api/v1/admin/organizations', 403],
        [who, 'POST /api/v1/admin/organizations', 403],
        // The public mount still hides a draft from its own members.
        [who, 'GET /api/v1/festivals/f-a', 404],
        [who, 'GET /api/v1/festivals/f-a/basemap', 404],
        [who, 'GET /api/v1/festivals/f-a-live', 200],
      );
    }
    const stranger = users.stranger.token;
    const adminOnly = async (url: string) => (await o.as(server, stranger).get(url)).status;
    assert.equal(await adminOnly('/api/v1/admin/organizations'), 403);
    assert.deepEqual(await runCells(server, tokensOf(users, ''), cells), []);
    const list = await o.as(server, users.ownerA.token).get('/api/v1/festivals');
    assert.deepEqual(
      list.body.data.map((f: any) => f.id).filter((id: string) => id.startsWith('f-')).sort(),
      ['f-a-live', 'f-p-live', 'f-s-live'],
      'the public list holds published festivals only',
    );
  });

  test('routes that stay admin are 404 on the manage mount, for a member and for an admin', async () => {
    const { server, users, adminToken } = await boot();
    const paths = [
      'POST /f-a/publish/decline',
      'POST /f-a/restore',
      'GET /archived',
      'GET /follows',
      'GET /locate-set/x1',
      'GET /f-a/basemap',
      'GET /f-a/time-releases',
      'GET /f-a/lineup-interest',
      'PUT /f-a/follow',
      'DELETE /',
      'PUT /',
      'GET /f-a/extra/segments',
    ];
    const cells: Cell[] = paths.flatMap((p) => ['ownerA', 'admin'].map((who) => [who, `${p.split(' ')[0]} ${MANAGE}${p.split(' ')[1]}`, 404] as Cell));
    assert.deepEqual(await runCells(server, tokensOf(users, adminToken), cells), []);
  });

  test('every manage response is per user: Vary Cookie and private, no-store', async () => {
    const { server, users } = await boot();
    const calls: Array<[string, string]> = [
      ['GET', `${MANAGE}/f-a`],
      ['GET', `${MANAGE}/f-b`],
      ['GET', `${MANAGE}/f-a/impact`],
      ['GET', `${MANAGE}/f-a/imports`],
      ['PUT', `${MANAGE}/f-a`],
      ['GET', MANAGE],
      ['GET', '/api/v1/manage/me'],
      ['GET', `${MANAGE}/archived`],
      ['POST', `${MANAGE}/f-a/publish`],
    ];
    const problems: string[] = [];
    for (const [method, url] of calls) {
      const caller = o.as(server, users.ownerA.token);
      const res = await (method === 'GET' ? caller.get(url) : (caller as any)[method.toLowerCase()](url, { name: 'Renamed' }));
      if (!String(res.headers.vary).includes('Cookie')) problems.push(`${method} ${url}: Vary is "${res.headers.vary}"`);
      if (res.headers['cache-control'] !== 'private, no-store') problems.push(`${method} ${url}: Cache-Control is "${res.headers['cache-control']}"`);
    }
    assert.deepEqual(problems, []);
  });

  test('with the flag off every manage path is 404 and every other route is admin-only again', async () => {
    const { server, users, adminToken } = await boot({ ORGANIZER_PLATFORM_ENABLED: 'false' });
    const cells: Cell[] = [
      ['ownerA', `GET ${MANAGE}/f-a`, 404],
      ['ownerA', `PUT ${MANAGE}/f-a`, 404],
      ['ownerA', 'GET /api/v1/manage/me', 404],
      ['ownerA', `POST ${MANAGE}`, 404],
      ['ownerA', `POST ${MANAGE}/f-a/publish-request`, 404],
      ['ownerA', `DELETE ${MANAGE}/f-a/publish-request`, 404],
      ['ownerA', `POST ${MANAGE}/f-a/publish`, 404],
      ['admin', 'GET /api/v1/manage/me', 404],
      ['admin', 'GET /api/v1/admin/organizations', 404],
      ['admin', 'GET /api/v1/admin/organizations/review-queue', 404],
      ['admin', 'POST /api/v1/admin/organizations', 404],
      ['ownerA', `GET ${ARTISTS}?q=a`, 404],
      ['ownerA', `POST ${ARTISTS}`, 404],
      ['anon', `GET ${MANAGE}/f-a`, 404],
      ['editorA', 'PUT /api/v1/festivals/f-a', 403],
      ['editorA', 'PUT /api/v1/festivals/f-a/sets/x1/link', 403],
      ['admin', 'PUT /api/v1/festivals/f-a', 400],
    ];
    assert.deepEqual(await runCells(server, tokensOf(users, adminToken), cells), []);
    const me = await o.as(server, users.ownerA.token).get('/api/v1/auth/me');
    assert.equal(me.status, 200);
    assert.deepEqual(me.body.data.organizations, []);
    assert.equal(me.body.data.organizerPlatform, false);
  });

  // The artist routes (routes/manage-artists.ts) are not festival-scoped: a read needs any role in an organization that
  // belongs to an active user, a write needs an owner or editor of one that is not suspended. A pending organization
  // may write. Admin-only suggestion routes keep the admin gate.
  test('artist routes: reads, writes, suspended and pending organizations, strangers and anonymous callers', async () => {
    const { server, users, adminToken } = await boot();
    let n = 0;
    const body = (url: string) => (url.endsWith('/match') ? { items: [{ name: 'Matrix Name' }] } : { name: `Matrix Artist ${Date.now()}-${++n}` });
    const reads: Cell[] = [];
    for (const who of ['viewerA', 'editorA', 'ownerA', 'ownerB', 'ownerS', 'ownerP']) {
      reads.push([who, `GET ${ARTISTS}?q=matrix`, 200], [who, `GET ${ARTISTS}/suggestions`, 200], [who, `POST ${ARTISTS}/match`, 200]);
    }
    for (const who of ['stranger', 'unconfirmed', 'admin']) {
      reads.push([who, `GET ${ARTISTS}?q=matrix`, 403], [who, `POST ${ARTISTS}/match`, 403], [who, `GET ${ARTISTS}/x1/impact`, 403]);
    }
    reads.push(['anon', `GET ${ARTISTS}?q=matrix`, 401], ['anon', `GET ${ARTISTS}/suggestions`, 401], ['anon', `POST ${ARTISTS}/match`, 401]);
    reads.push(['editorA', `GET ${ARTISTS}/x1/impact`, 404], ['viewerA', `GET ${ARTISTS}/x1/impact`, 404]);
    const writes: Cell[] = [
      ['ownerA', `POST ${ARTISTS}`, 201],
      ['editorA', `POST ${ARTISTS}`, 201],
      ['ownerB', `POST ${ARTISTS}`, 201],
      ['ownerP', `POST ${ARTISTS}`, 201],
      ['viewerA', `POST ${ARTISTS}`, 403],
      ['ownerS', `POST ${ARTISTS}`, 403],
      ['stranger', `POST ${ARTISTS}`, 403],
      ['unconfirmed', `POST ${ARTISTS}`, 403],
      ['anon', `POST ${ARTISTS}`, 401],
    ];
    assert.deepEqual(await runCells(server, tokensOf(users, adminToken), [...reads, ...writes], body), []);

    const update = { expectedUpdatedAt: '2999-01-01T00:00:00.000Z', changes: { label: 'x' } };
    const edits: Cell[] = [
      ['editorA', `PATCH ${ARTISTS}/x1`, 404],
      ['ownerA', `PATCH ${ARTISTS}/x1`, 404],
      ['viewerA', `PATCH ${ARTISTS}/x1`, 403],
      ['ownerS', `PATCH ${ARTISTS}/x1`, 403],
      ['stranger', `PATCH ${ARTISTS}/x1`, 403],
      ['anon', `PATCH ${ARTISTS}/x1`, 401],
    ];
    assert.deepEqual(await runCells(server, tokensOf(users, adminToken), edits, () => update), []);

    // Admin-only: the suggestion list, the decision and verify. A member of an organization gets the admin answer.
    const adminOnly: Cell[] = [
      ['anon', `GET ${ADMIN_ARTISTS}/suggestions`, 401],
      ['stranger', `GET ${ADMIN_ARTISTS}/suggestions`, 403],
      ['ownerA', `GET ${ADMIN_ARTISTS}/suggestions`, 403],
      ['admin', `GET ${ADMIN_ARTISTS}/suggestions`, 200],
      ['ownerA', `POST ${ADMIN_ARTISTS}/suggestions/x1/decision`, 403],
      ['admin', `POST ${ADMIN_ARTISTS}/suggestions/x1/decision`, 404],
      ['ownerA', `POST ${ADMIN_ARTISTS}/x1/verify`, 403],
      ['admin', `POST ${ADMIN_ARTISTS}/x1/verify`, 404],
    ];
    assert.deepEqual(await runCells(server, tokensOf(users, adminToken), adminOnly, () => ({ decision: 'accept' })), []);
  });

  test('with the flag on, an editor of A is 403 on PUT /festivals/:id and its set-link route', async () => {
    const { server, users } = await boot();
    const cells: Cell[] = [
      ['editorA', 'PUT /api/v1/festivals/f-a', 403],
      ['editorA', 'PUT /api/v1/festivals/f-a/sets/x1/link', 403],
    ];
    assert.deepEqual(await runCells(server, tokensOf(users, ''), cells), []);
  });
});
