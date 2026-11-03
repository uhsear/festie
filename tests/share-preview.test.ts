// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Unit tests (no DB) for the share page link previews: og:image, JSON-LD,
 * 12-hour times, the compare call to action, the og.png route and the vanity JSON route.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import sharp from 'sharp';
import { buildShareOgSvg, pickOgArtists } from '../lib/helpers/share-og-image.js';

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

function makeFestival(overrides: any = {}) {
  return {
    id: 'f1', name: 'Test Fest', location: 'Somewhere', b2bSeparator: 'b2b',
    stages: [{ id: 'stg-1', name: 'Main', color: '#ff3366' }],
    days: [
      {
        label: 'Friday', date: '2026-06-05',
        sets: [
          { id: 'set-a', artist: 'Alpha', stageId: 'stg-1', startTime: '21:30', endTime: '22:45' },
          { id: 'set-b', artist: 'Bravo', stageId: 'stg-1', startTime: null, endTime: null },
        ],
      },
      {
        label: 'Saturday', date: '2026-06-06',
        sets: [{ id: 'set-c', artist: 'Charlie', stageId: 'stg-1', startTime: '20:00', endTime: '' }],
      },
    ],
    ...overrides,
  };
}

function makeDeps(overrides: any = {}) {
  const festival = overrides.festival ?? makeFestival();
  return {
    express,
    config: { NODE_ENV: 'test', PUBLIC_ORIGIN: 'http://localhost:3000' },
    log: noopLog,
    stores: {
      users: {
        getByUsername: mock.fn(async () => overrides.user ?? null),
      },
      profiles: {
        getById: mock.fn(async (id: string) => ({
          id, userId: 'u1', festivalId: 'f1',
          picks: overrides.picks ?? { 'set-a': 'must', 'set-b': 'want-to-see', 'set-c': 'maybe' },
        })),
      },
      // T22 share links: tokens resolve to a profile; a reset token resolves to null.
      shareLinks: {
        findProfileId: mock.fn(async (id: string) => (id === 'reset-token' ? null : 'p1')),
        newestProfile: mock.fn(async () => ({ profileId: 'p1', festivalId: 'f1', festivalName: festival.name })),
      },
    },
    getFestivalById: mock.fn(async () => festival),
    getUserById: mock.fn(async (id: any) => ({ id, username: 'testuser' })),
    buildAvatarUrl: mock.fn(() => ''),
    rateLimit: () => (_req: any, _res: any, next: any) => next(),
    sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
    sendError: (res: any, status: any, msg: any, code: any) =>
      res.status(status).json({ data: null, error: { message: msg, status, code: code || 'ERROR' } }),
    ErrorCodes: { INVALID_INPUT: 'INVALID_INPUT', NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR' },
  };
}

async function buildApp(overrides: any = {}) {
  const { default: createShareRoutes } = await import('../routes/share.js');
  const app = express();
  app.use('/s', createShareRoutes(makeDeps(overrides)));
  return app;
}

function jsonLdBlocks(html: string) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

const binaryParser = (res: any, cb: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('share page previews', () => {
  test('has og:image, a large twitter card, theme-color and one Event JSON-LD block', async () => {
    const res = await request(await buildApp()).get('/s/tok123');
    assert.equal(res.status, 200);
    assert.match(res.text, /<meta property="og:image" content="http:\/\/localhost:3000\/s\/tok123\/og\.png">/);
    assert.ok(res.text.includes('<meta name="twitter:card" content="summary_large_image">'));
    assert.ok(!res.text.includes('content="summary"'));
    assert.ok(res.text.includes('<meta name="theme-color" content="#080810">'));
    assert.ok(res.text.includes('og:image:alt" content="testuser&#39;s picks for Test Fest"'));
    const blocks = jsonLdBlocks(res.text);
    assert.equal(blocks.length, 1);
    const event = JSON.parse(blocks[0]!);
    assert.equal(event['@type'], 'Event');
    assert.equal(event.name, 'Test Fest');
    assert.equal(event.startDate, '2026-06-05');
    assert.equal(event.endDate, '2026-06-06');
    assert.equal(event.url, 'http://localhost:3000/s/tok123');
    assert.deepEqual(event.image, ['http://localhost:3000/s/tok123/og.png']);
    assert.equal(event.location.name, 'Somewhere');
  });

  test('a festival name cannot break out of the title or the JSON-LD script', async () => {
    const res = await request(await buildApp({ festival: makeFestival({ name: '</script><b>x' }) })).get('/s/tok123');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('&lt;/script&gt;&lt;b&gt;x'));
    assert.ok(!res.text.includes('<b>x'));
    const [block] = jsonLdBlocks(res.text);
    assert.ok(block!.includes('\\u003c/script\\u003e'));
    assert.equal(JSON.parse(block!).name, '</script><b>x');
  });

  test('geo appears only when latitude and longitude are numbers', async () => {
    const withGeo = await request(await buildApp({ festival: makeFestival({ latitude: 28.5, longitude: -81.4 }) })).get('/s/tok123');
    const geo = JSON.parse(jsonLdBlocks(withGeo.text)[0]!).location.geo;
    assert.deepEqual(geo, { '@type': 'GeoCoordinates', latitude: 28.5, longitude: -81.4 });

    for (const coords of [{}, { latitude: '28.5', longitude: '-81.4' }, { latitude: null, longitude: null }]) {
      const res = await request(await buildApp({ festival: makeFestival(coords) })).get('/s/tok123');
      assert.equal(JSON.parse(jsonLdBlocks(res.text)[0]!).location.geo, undefined);
    }
  });

  test('times render 12-hour, start only without an end, and Time TBA without a start', async () => {
    const res = await request(await buildApp()).get('/s/tok123');
    assert.ok(res.text.includes('<div class="share-set-time">9:30 PM – 10:45 PM</div>'));
    assert.ok(res.text.includes('<div class="share-set-time">8:00 PM</div>'));
    assert.ok(res.text.includes('<div class="share-set-time">Time TBA</div>'));
    assert.ok(!res.text.includes('21:30'));
  });

  test('call to action links to the compare page and the app', async () => {
    const res = await request(await buildApp()).get('/s/tok123');
    assert.ok(res.text.includes('href="http://localhost:3000/friend-picks?from=tok123">Compare with my picks'));
    assert.ok(res.text.includes('href="http://localhost:3000/friend-picks?from=tok123#add">Add their picks to my plan'));
    assert.ok(res.text.includes('href="festie://friend-picks?from=tok123">Open in the app'));
    assert.ok(res.text.includes('New to Festie? Plan your own schedule'));
    assert.ok(!res.text.includes('Compare picks with your crew on Festie'));
  });

  test('vanity page links use u/<username> as the ref', async () => {
    const app = await buildApp({ user: { id: 'u1', username: 'testuser', publicSchedule: true } });
    const res = await request(app).get('/s/u/TestUser');
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('/friend-picks?from=u%2Ftestuser'));
    assert.ok(res.text.includes('festie://friend-picks?from=u%2Ftestuser'));
    assert.ok(res.text.includes('content="http://localhost:3000/s/u/testuser/og.png"'));
  });
});

describe('GET og.png', () => {
  test('token route returns a 1200x630 PNG with private, no-cache', async () => {
    const res = await request(await buildApp()).get('/s/tok123/og.png').buffer(true).parse(binaryParser);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.equal(res.headers['cache-control'], 'private, no-cache');
    assert.equal(res.headers['x-robots-tag'], 'noindex');
    const png: Buffer = res.body;
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 1200);
    assert.equal(meta.height, 630);
  });

  test('a reset token returns a plain 404', async () => {
    const res = await request(await buildApp()).get('/s/reset-token/og.png');
    assert.equal(res.status, 404);
    assert.equal(res.text, '');
  });

  test('vanity route serves a public user and 404s a private one', async () => {
    const pub = await request(await buildApp({ user: { id: 'u1', username: 'testuser', publicSchedule: true } }))
      .get('/s/u/testuser/og.png').buffer(true).parse(binaryParser);
    assert.equal(pub.status, 200);
    assert.equal(pub.headers['content-type'], 'image/png');

    const priv = await request(await buildApp({ user: { id: 'u1', username: 'testuser', publicSchedule: false } }))
      .get('/s/u/testuser/og.png');
    assert.equal(priv.status, 404);
  });
});

describe('GET /s/u/:username/json', () => {
  test('returns 404 for a private user', async () => {
    const res = await request(await buildApp({ user: { id: 'u1', username: 'testuser', publicSchedule: false } }))
      .get('/s/u/testuser/json');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('returns 400 for an invalid username', async () => {
    const res = await request(await buildApp()).get('/s/u/bad!name/json');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  });

  test('returns the payload with festival.b2bSeparator for a public user', async () => {
    const res = await request(await buildApp({ user: { id: 'u1', username: 'testuser', publicSchedule: true } }))
      .get('/s/u/testuser/json');
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'private, no-cache');
    assert.equal(res.body.data.username, 'testuser');
    assert.equal(res.body.data.festivalId, 'f1');
    assert.equal(res.body.data.festival.b2bSeparator, 'b2b');
    assert.equal(res.body.data.festival.days.length, 2);
  });

  test('token JSON also carries b2bSeparator, null when unset', async () => {
    const res = await request(await buildApp({ festival: makeFestival({ b2bSeparator: undefined }) })).get('/s/tok123/json');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.festival.b2bSeparator, null);
  });
});

describe('buildShareOgSvg', () => {
  const base = { username: 'sam', festivalName: 'Fest', location: '', artists: [], total: 3, must: 1 };

  test('escapes every text value', () => {
    const svg = buildShareOgSvg({
      ...base, username: '<u>&', festivalName: '</text><script>', location: 'A "B"', artists: ['<x>'],
    });
    assert.ok(!svg.includes('<script>'));
    assert.ok(!svg.includes('<u>'));
    assert.ok(!svg.includes('<x>'));
    assert.ok(svg.includes('&lt;/text&gt;&lt;script&gt;'));
    assert.ok(svg.includes('&lt;u&gt;&amp;&#39;s picks'));
    assert.ok(svg.includes('A &quot;B&quot;'));
    assert.ok(svg.includes('3 sets · 1 must-see'));
    assert.ok(svg.includes('>FESTIE<'));
  });

  test('truncates the festival name at 32 and artists at 28 characters, and shows at most 5 artists', () => {
    const svg = buildShareOgSvg({
      ...base,
      festivalName: 'F'.repeat(40),
      artists: ['A'.repeat(30), 'b', 'c', 'd', 'e', 'sixth'],
    });
    assert.ok(svg.includes(`>${'F'.repeat(32)}…<`));
    assert.ok(svg.includes(`>${'A'.repeat(28)}…<`));
    assert.ok(!svg.includes('sixth'));
    assert.ok(svg.includes('width="1200" height="630"'));
  });

  test('leaves short values whole', () => {
    const svg = buildShareOgSvg({ ...base, festivalName: 'F'.repeat(32) });
    assert.ok(svg.includes(`>${'F'.repeat(32)}<`));
  });
});

describe('pickOgArtists', () => {
  test('Must first, then Want; by day, then festival time with past-midnight last; TBA last; maybe left out', () => {
    const festival = {
      days: [
        {
          sets: [
            { id: 'night', artist: 'Night', startTime: '01:00' },
            { id: 'late', artist: 'Late', startTime: '23:30' },
            { id: 'tba', artist: 'Tba', startTime: null },
            { id: 'want1', artist: 'Want1', startTime: '18:00' },
            { id: 'maybe', artist: 'Maybe', startTime: '12:00' },
          ],
        },
        { sets: [{ id: 'day2', artist: 'DayTwo', startTime: '14:00' }] },
      ],
    };
    const picks = { night: 'must', late: 'must', tba: 'must', day2: 'must', want1: 'want-to-see', maybe: 'maybe' };
    assert.deepEqual(pickOgArtists(festival, picks, 'b2b'), ['Late', 'Night', 'DayTwo', 'Tba', 'Want1']);
  });

  test('joins B2B artists with the festival separator', () => {
    const festival = { days: [{ sets: [{ id: 's1', artist: 'ignored', artists: [{ name: 'A' }, { name: 'B' }], startTime: '20:00' }] }] };
    assert.deepEqual(pickOgArtists(festival, { s1: 'must' }, 'x'), ['A x B']);
  });
});
