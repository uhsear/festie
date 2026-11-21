import 'dotenv/config';
/**
 * The public /delete-account page (Apple 5.1.1(v), Google Play account deletion policy):
 * readable without signing in, linked to the in-app delete flow, and free of third-party hosts.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import { bootServer } from './_boot-server';
import { requireTestDatabaseUrl } from './_test-schema';

const PAGE = path.join(import.meta.dirname, '..', 'public', 'delete-account.html');
const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});

describe('public/delete-account.html', () => {
  const html = readFileSync(PAGE, 'utf8');

  test('explains the in-app and web paths, the 30-day grace period and what stays', () => {
    assert.match(html, /Delete your account in the app/);
    assert.match(html, /Delete your account on the web/);
    assert.match(html, /30 days/);
    assert.match(html, /What we delete/);
    assert.match(html, /What stays/);
    assert.match(html, /mailto:privacy@festie\.us/);
  });

  test('offers a path to the signed-in delete flow and links the legal pages', () => {
    assert.match(html, /href="\/account#danger"/);
    assert.match(html, /href="\/privacy\.html"/);
    assert.match(html, /href="\/terms\.html"/);
  });

  test('runs no script and loads nothing from another host', () => {
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /(?:src|href)="https?:\/\/(?!festie\.us)/i);
    assert.match(html, /href="\/fonts\/space-grotesk\/space-grotesk\.css"/);
  });
});

describe('GET /delete-account', () => {
  test('serves the page to a visitor with no session, at both URLs', async () => {
    const server = await bootServer(requireTestDatabaseUrl()!);
    servers.push(server);
    for (const url of ['/delete-account', '/delete-account.html']) {
      const res = await server.request.get(url);
      assert.equal(res.status, 200, url);
      assert.match(String(res.headers['content-type']), /text\/html/);
      assert.match(res.text, /Delete your Festie account/);
    }
  });
});
