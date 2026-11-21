import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import express from 'express';

import { createSessionHelpers } from '../lib/app-context/session';
import { buildFestivalMounts } from '../lib/festival-mounts';
import { generateOpenAPISpec } from '../lib/openapi.js';
import createAccountRoutes from '../routes/account';
import createActivityRoutes from '../routes/activity';
import createAdminRoutes from '../routes/admin';
import createAnalyticsInstallRoutes from '../routes/analytics-install';
import createArtistsRoutes from '../routes/artists';
import createAuthRoutes from '../routes/auth';
import createCalendarSyncRoutes from '../routes/calendar-sync';
import createClientMetricsRoutes from '../routes/client-metrics';
import createCrewRoutes from '../routes/crews';
import createEmailAuthRoutes from '../routes/email-auth';
import createExpenseRoutes from '../routes/expenses';
import createExportRoutes from '../routes/export';
import createHealthRoutes from '../routes/health';
import createIdentityRoutes from '../routes/identities';
import createNotificationRoutes from '../routes/notifications';
import createOAuthRoutes from '../routes/oauth';
import createOrganizationsRoutes from '../routes/organizations';
import createProfileRoutes from '../routes/profiles';
import { createRatingsRoutes } from '../routes/ratings';
import createSpotifyRoutes from '../routes/spotify';
import { createWeatherRoutes } from '../routes/weather';

describe('openapi: generateOpenAPISpec', () => {
  it('returns a valid OpenAPI 3.0.3 object', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.openapi, '3.0.3');
    assert.ok(spec.info);
    assert.ok(spec.paths);
    assert.ok(spec.components);
  });

  it('includes Festie API title', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.info.title, 'Festie API');
  });

  it('uses API_VERSION from config', () => {
    const spec = generateOpenAPISpec({ API_VERSION: '3' });
    assert.equal(spec.info.version, '1.3');
  });

  it('defaults to version 1.0 when API_VERSION is absent', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.info.version, '1.0');
  });

  it('uses PUBLIC_ORIGIN for server URL when provided', () => {
    const spec = generateOpenAPISpec({ PUBLIC_ORIGIN: 'https://festie.us' });
    assert.equal(spec.servers[0]!.url, 'https://festie.us');
    assert.equal(spec.servers[0]!.description, 'Production');
  });

  it('defaults to localhost when PUBLIC_ORIGIN is absent', () => {
    const spec = generateOpenAPISpec({});
    assert.equal(spec.servers[0]!.url, 'http://localhost:4000');
    assert.equal(spec.servers[0]!.description, 'Local dev');
  });

  it('defines bearerAuth and cookieAuth security schemes', () => {
    const spec = generateOpenAPISpec({});
    const schemes = spec.components.securitySchemes;
    assert.equal(schemes.bearerAuth.type, 'http');
    assert.equal(schemes.bearerAuth.scheme, 'bearer');
    assert.equal(schemes.cookieAuth.type, 'apiKey');
    assert.equal(schemes.cookieAuth.in, 'cookie');
  });

  it('defines Error and Success component schemas', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.components.schemas.Error);
    assert.ok(spec.components.schemas.Success);
  });

  it('defines User, Festival, Stage, Day, Set, Profile schemas', () => {
    const spec = generateOpenAPISpec({});
    const schemas = spec.components.schemas;
    for (const name of ['User', 'Festival', 'Stage', 'Day', 'Set', 'Profile']) {
      assert.ok((schemas as Record<string, any>)[name], `Missing schema: ${name}`);
    }
  });

  it('includes auth endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/auth/register']);
    assert.ok(spec.paths['/api/v1/auth/login']);
    assert.ok(spec.paths['/api/v1/auth/logout']);
    assert.ok(spec.paths['/api/v1/auth/me']);
    assert.ok(spec.paths['/api/v1/auth/refresh-token']);
  });

  it('includes festival, profile, and crew endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/festivals']);
    assert.ok(spec.paths['/api/v1/festivals/{id}']);
    assert.ok(spec.paths['/api/v1/profiles/{festivalId}']);
    assert.ok(spec.paths['/api/v1/crews']);
  });

  it('includes health endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/health/live']);
    assert.ok(spec.paths['/api/v1/health']);
  });

  it('includes notification endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/notifications/tokens']);
    assert.ok(spec.paths['/api/v1/notifications/preferences']);
  });

  it('includes admin bulk endpoints', () => {
    const spec = generateOpenAPISpec({});
    assert.ok(spec.paths['/api/v1/admin/bulk/deactivate']);
    assert.ok(spec.paths['/api/v1/admin/bulk/archive-festivals']);
  });

  it('has expected tags', () => {
    const spec = generateOpenAPISpec({});
    const tagNames = spec.tags.map((t: any) => t.name);
    assert.ok(tagNames.includes('Auth'));
    assert.ok(tagNames.includes('Festivals'));
    assert.ok(tagNames.includes('Crews'));
    assert.ok(tagNames.includes('Health'));
    assert.ok(tagNames.includes('Notifications'));
  });

  it('derives the register request body from the Zod schema (drift closed)', () => {
    // The register request body is now a projection of `registerSchema` in
    // lib/schemas.ts via zod-openapi — NOT a hand-written duplicate. This pins
    // the username bounds to the authoritative validator (z.string().min(1).max(40))
    // and guards against the old drift where the hand-written spec claimed
    // minLength:2 / maxLength:30.
    const spec = generateOpenAPISpec({});
    const body = (spec.paths['/api/v1/auth/register'] as any).post.requestBody;
    const schema = body.content['application/json'].schema;
    const username = schema.properties.username;
    assert.equal(username.type, 'string');
    assert.equal(username.minLength, 1, 'username minLength must equal the Zod schema (.min(1))');
    assert.equal(username.maxLength, 40, 'username maxLength must equal the Zod schema (.max(40))');
    // Password bounds also come from the Zod schema (.min(8).max(200)).
    assert.equal(schema.properties.password.minLength, 8);
    assert.equal(schema.properties.password.maxLength, 200);
    // Fields the validator requires but the old hand-written spec omitted are
    // now documented because they are derived, not transcribed.
    assert.ok(schema.required.includes('username'));
    assert.ok(schema.required.includes('dateOfBirth'));
    assert.ok(schema.required.includes('tosAccepted'));
  });

  it('derives the login request body from the Zod schema', () => {
    const spec = generateOpenAPISpec({});
    const schema = (spec.paths['/api/v1/auth/login'] as any).post.requestBody.content['application/json'].schema;
    // loginSchema enforces username .max(254) (a username or an email) — the derived spec reflects it.
    assert.equal(schema.properties.username.maxLength, 254);
    assert.deepEqual([...schema.required].sort(), ['password', 'username']);
  });

  it('derives the festival depth query parameter from the Zod schema', () => {
    const spec = generateOpenAPISpec({});
    const params = (spec.paths['/api/v1/festivals/{id}'] as any).get.parameters as any[];
    const depth = params.find((p) => p.name === 'depth');
    assert.ok(depth, 'depth query param present');
    assert.equal(depth.in, 'query');
    // festivalDepthQuery is z.coerce.number().int().min(0).max(2).optional()
    assert.equal(depth.required, false);
    assert.equal(depth.schema.minimum, 0);
    assert.equal(depth.schema.maximum, 2);
  });

  it('handles null config gracefully', () => {
    const spec = generateOpenAPISpec(null);
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(spec.info.version, '1.0');
  });

  it('handles undefined config gracefully', () => {
    const spec = generateOpenAPISpec(undefined);
    assert.equal(spec.openapi, '3.0.3');
  });
});

// Construction-only deps: handlers never run, so every dependency except express and the real
// session guards is a callable that returns itself (same technique as festival-access-matrix.test.ts).
function constructionDeps() {
  const stub: any = new Proxy(function () {}, {
    get: (_target, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => 1 : stub),
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
  const fallback = (own: any) => new Proxy(own, { get: (target, prop) => (prop in target ? target[prop] : stub) });
  const config = fallback({ PUBLIC_DIR: 'public' });
  // crews.ts spreads deps into its sub-routers, and a spread copies only own keys, so name the stubs they call at construction.
  const spread = { schemas: stub, rateLimits: stub, ErrorCodes: stub, stores: stub, log: stub, pool: stub, rateLimit: stub, userAuth: stub, validate: stub, validateParams: stub, validateQuery: stub, sendSuccess: stub, sendError: stub };
  return fallback({ ...spread, express, config, festivalAccess: sessions.festivalAccess, adminAuth: sessions.adminAuth });
}

// Every /api/v1 mount in server.ts except the festival mounts, which buildFestivalMounts supplies.
function collectRoutes(): string[] {
  const deps = constructionDeps();
  const mounts: Array<[string, any]> = [
    ['/api/v1/auth', createAuthRoutes(deps)],
    ['/api/v1/auth', createEmailAuthRoutes(deps)],
    ['/api/v1/auth', createOAuthRoutes(deps)],
    ['/api/v1/auth', createIdentityRoutes(deps)],
    ['/api/v1/account', createAccountRoutes(deps)],
    ['/api/v1/admin', createAdminRoutes(deps)],
    ['/api/v1/admin/artists', createArtistsRoutes(deps)],
    ...buildFestivalMounts(deps).map(({ prefix, router }): [string, any] => [prefix, router]),
    // The admin organizations router is mounted only while ORGANIZER_PLATFORM_ENABLED is on, which this test leaves unset.
    ['/api/v1/admin/organizations', createOrganizationsRoutes(deps)],
    ['/api/v1/profiles', createProfileRoutes(deps)],
    ['/api/v1', createExportRoutes(deps)],
    ['/api/v1/notifications', createNotificationRoutes(deps)],
    ['/api/v1', createSpotifyRoutes(deps)],
    ['/api/v1/crews', createCrewRoutes(deps)],
    ['/api/v1/ratings', createRatingsRoutes(deps)],
    ['/api/v1/weather', createWeatherRoutes(deps)],
    ['/api/v1', createExpenseRoutes(deps)],
    ['/api/v1', createActivityRoutes(deps)],
    ['/api/v1', createCalendarSyncRoutes(deps)],
    ['/api/v1/analytics', createAnalyticsInstallRoutes(deps)],
    ['/api/v1/metrics', createClientMetricsRoutes(deps)],
    ['/api/v1', createHealthRoutes(deps).router],
  ];
  const keys = new Set<string>();
  const walk = (prefix: string, router: any) => {
    for (const layer of router.stack) {
      if (layer.route) {
        const path = `${prefix}${layer.route.path}`.replace(/:(\w+)/g, '{$1}').replace(/(.)\/$/, '$1');
        for (const method of Object.keys(layer.route.methods)) keys.add(`${method.toUpperCase()} ${path}`);
      } else if (layer.handle?.stack) {
        walk(prefix, layer.handle);
      }
    }
  };
  for (const [prefix, router] of mounts) walk(prefix, router);
  return [...keys].sort();
}

// Routes that are in no public spec yet. Do not add to this list: document the new route in
// lib/openapi.ts instead. Remove an entry when its route is documented or deleted.
const ALLOWLIST: Record<string, string> = {
  'DELETE /api/v1/account': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/account/avatar': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/admin/crews/{id}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/crews/{id}/members/{userId}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/festivals/{id}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/organizations/held-alerts/{festivalId}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/organizations/{id}/festivals/{festivalId}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/organizations/{id}/members/{userId}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/organizations/{id}/pending-members/{email}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/users/{id}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/admin/users/{id}/roles/{role}': 'admin: out of the public spec on purpose',
  'DELETE /api/v1/auth/identities/{provider}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/auth/sessions': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/auth/sessions/{id}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/expenses/{expenseId}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/leave': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/live-location': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/meeting-points/{mpId}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/members/{userId}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/packing/{itemId}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/polls/{pollId}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/rides/{itemId}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/crews/{crewId}/rides/{itemId}/seat': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/festivals/{id}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/notifications/token': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/profiles/{id}': 'undocumented: public route not yet in the spec',
  'DELETE /api/v1/ratings/{setId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/account/export': 'undocumented: public route not yet in the spec',
  'GET /api/v1/account/sharing': 'undocumented: public route not yet in the spec',
  'GET /api/v1/admin/analytics': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/analytics/festivals/{festivalId}/picks': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/artists': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/artists/{id}/impact': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/artists/suggestions': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/audit': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/crews': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/crews/{id}/members': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/dashboard': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/festivals/locate-set/{setId}': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/festivals/{festivalId}/sets/links': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/festivals/{id}/basemap': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/festivals/{id}/lineup-interest': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/festivals/{id}/set-engagement': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/growth': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/organizations': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/organizations/review-queue': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/organizations/{id}': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/health': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/ref-counts': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/status': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/users': 'admin: out of the public spec on purpose',
  'GET /api/v1/admin/users/{id}': 'admin: out of the public spec on purpose',
  'GET /api/v1/auth/identities': 'undocumented: public route not yet in the spec',
  'GET /api/v1/auth/providers': 'undocumented: public route not yet in the spec',
  'GET /api/v1/auth/sessions': 'undocumented: public route not yet in the spec',
  'GET /api/v1/auth/unsubscribe': 'undocumented: public route not yet in the spec',
  'GET /api/v1/auth/verify-email': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/join-preview/{inviteCode}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/join/{inviteCode}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/search-users': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/{crewId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/{crewId}/checkin': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/{crewId}/expenses/balances': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/{crewId}/meeting-points': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/{crewId}/meeting-points/past': 'undocumented: public route not yet in the spec',
  'GET /api/v1/crews/{crewId}/sos': 'undocumented: public route not yet in the spec',
  'GET /api/v1/export/{festivalId}/{profileId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/festivals/archived': 'undocumented: public route not yet in the spec',
  'GET /api/v1/festivals/locate-set/{setId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/festivals/{festivalId}/sets/links': 'undocumented: public route not yet in the spec',
  'GET /api/v1/festivals/{id}/basemap': 'undocumented: public route not yet in the spec',
  'GET /api/v1/festivals/{id}/impact': 'undocumented: public route not yet in the spec',
  'GET /api/v1/info': 'health: out of the public spec on purpose',
  'GET /api/v1/internal/metrics-json': 'internal: out of the public spec on purpose',
  'GET /api/v1/metrics': 'internal: out of the public spec on purpose',
  'GET /api/v1/notifications/history': 'undocumented: public route not yet in the spec',
  'GET /api/v1/notifications/prefs': 'undocumented: public route not yet in the spec',
  'GET /api/v1/notifications/topics/{festivalId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/notifications/unread': 'undocumented: public route not yet in the spec',
  'GET /api/v1/notifications/vapid-key': 'undocumented: public route not yet in the spec',
  'GET /api/v1/presence/{festivalId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/ratings/crew-wrap/{crewId}/{festivalId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/ratings/crew/{crewId}/festival/{festivalId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/ratings/festival/{festivalId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/ratings/festival/{festivalId}/all': 'undocumented: public route not yet in the spec',
  'GET /api/v1/ratings/lifetime': 'undocumented: public route not yet in the spec',
  'GET /api/v1/ratings/wrap/{festivalId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/ready': 'health: out of the public spec on purpose',
  'GET /api/v1/spotify/preview/{setId}': 'undocumented: public route not yet in the spec',
  'GET /api/v1/weather/{festivalId}': 'undocumented: public route not yet in the spec',
  'PATCH /api/v1/account/display-name': 'undocumented: public route not yet in the spec',
  'PATCH /api/v1/account/payment-handles': 'undocumented: public route not yet in the spec',
  'PATCH /api/v1/account/public-schedule': 'undocumented: public route not yet in the spec',
  'PATCH /api/v1/admin/artists/{id}': 'admin: out of the public spec on purpose',
  'PATCH /api/v1/notifications/prefs': 'undocumented: public route not yet in the spec',
  'PATCH /api/v1/profiles/{id}': 'undocumented: public route not yet in the spec',
  'POST /api/v1/account/avatar': 'undocumented: public route not yet in the spec',
  'POST /api/v1/account/email': 'undocumented: public route not yet in the spec',
  'POST /api/v1/account/share-link/{festivalId}': 'undocumented: public route not yet in the spec',
  'POST /api/v1/account/sharing/reset': 'undocumented: public route not yet in the spec',
  'POST /api/v1/account/stop-sharing': 'undocumented: public route not yet in the spec',
  'POST /api/v1/admin/artists': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/backfill': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/match': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/spotify-candidates': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/spotify-picks': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/spotify-refresh': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/spotify-refresh-stale': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/{id}/merge': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/{id}/verify': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/artists/suggestions/{id}/decision': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/festivals': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/festivals/{id}/backfill-spotify': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/festivals/{id}/siteplan-image': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/festivals/{id}/publish/decline': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/organizations': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/organizations/held-alerts/{festivalId}/release': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/organizations/{id}/festivals': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/organizations/{id}/members': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/policy-notice': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/users/{id}/reset-link': 'admin: out of the public spec on purpose',
  'POST /api/v1/admin/users/{id}/roles': 'admin: out of the public spec on purpose',
  'POST /api/v1/analytics/install': 'internal: out of the public spec on purpose',
  'POST /api/v1/auth/change-password': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/forgot-password': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/identities/{provider}': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/oauth/complete': 'oauth: out of the public spec on purpose',
  'POST /api/v1/auth/oauth/nonce': 'oauth: out of the public spec on purpose',
  'POST /api/v1/auth/oauth/{provider}': 'oauth: out of the public spec on purpose',
  'POST /api/v1/auth/reauth': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/resend-verification': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/reset-password': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/set-password': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/unsubscribe': 'undocumented: public route not yet in the spec',
  'POST /api/v1/auth/verify': 'undocumented: public route not yet in the spec',
  'POST /api/v1/calendar-sync/{festivalId}': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/join': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/checkin': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/checkin/done': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/expenses/remind': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/expenses/settle': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/expenses/{expenseId}/confirm': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/invite': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/live-location': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/meeting-points': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/members': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/members/{userId}/nudge': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/packing/batch': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/polls/{pollId}/nudge': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/polls/{pollId}/vote': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/reform': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/rides/{itemId}/seat': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/sos': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/sos/clear': 'undocumented: public route not yet in the spec',
  'POST /api/v1/crews/{crewId}/sos/seen': 'undocumented: public route not yet in the spec',
  'POST /api/v1/csp-report': 'internal: out of the public spec on purpose',
  'POST /api/v1/festivals': 'undocumented: public route not yet in the spec',
  'POST /api/v1/festivals/{id}/publish': 'undocumented: public route not yet in the spec',
  'POST /api/v1/festivals/{id}/publish/decline': 'admin: out of the public spec on purpose',
  'POST /api/v1/festivals/{id}/restore': 'undocumented: public route not yet in the spec',
  'POST /api/v1/metrics/client': 'internal: out of the public spec on purpose',
  'POST /api/v1/metrics/web-vitals': 'internal: out of the public spec on purpose',
  'POST /api/v1/notifications/read': 'undocumented: public route not yet in the spec',
  'POST /api/v1/notifications/token': 'undocumented: public route not yet in the spec',
  'POST /api/v1/profiles': 'undocumented: public route not yet in the spec',
  'POST /api/v1/ratings/{setId}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/account/display-name': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/account/payment-handles': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/account/public-schedule': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/admin/festivals/{festivalId}/sets/{setId}/link': 'admin: out of the public spec on purpose',
  'PUT /api/v1/admin/festivals/{id}': 'admin: out of the public spec on purpose',
  'PUT /api/v1/admin/organizations/{id}/members/{userId}': 'admin: out of the public spec on purpose',
  'PUT /api/v1/admin/organizations/{id}/status': 'admin: out of the public spec on purpose',
  'PUT /api/v1/admin/organizations/{id}/verified': 'admin: out of the public spec on purpose',
  'PUT /api/v1/admin/users/{id}/reset-password': 'admin: out of the public spec on purpose',
  'PUT /api/v1/crews/{crewId}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/expenses/currency': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/expenses/{expenseId}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/home-base': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/meeting-points/{mpId}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/packing/{itemId}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/photo-album': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/rides/{itemId}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/crews/{crewId}/transfer': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/festivals/{festivalId}/sets/{setId}/link': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/festivals/{id}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/notifications/prefs': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/notifications/topics/{festivalId}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/profiles/{id}': 'undocumented: public route not yet in the spec',
  'PUT /api/v1/ratings/{setId}/caught': 'undocumented: public route not yet in the spec',
};

describe('openapi: route coverage', () => {
  const documented = new Set<string>();
  const spec = generateOpenAPISpec({});
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    for (const method of Object.keys(item)) documented.add(`${method.toUpperCase()} ${path}`);
  }
  const routes = collectRoutes();

  it('documents every public /api/v1 route or lists it in ALLOWLIST', () => {
    const missing = routes.filter((key) => !documented.has(key) && !(key in ALLOWLIST));
    assert.deepEqual(missing, [], 'Undocumented routes: document them in lib/openapi.ts or add them to ALLOWLIST with a reason.');
  });

  it('keeps ALLOWLIST free of stale entries', () => {
    const live = new Set(routes);
    const stale = Object.keys(ALLOWLIST).filter((key) => !live.has(key) || documented.has(key));
    assert.deepEqual(stale, [], 'ALLOWLIST entries that are documented or no longer registered. Remove them.');
  });
});
