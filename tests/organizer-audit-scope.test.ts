import 'dotenv/config';
/**
 * The activity view of an organization never shows the festival ids that a shared-artist edit rewrote, because
 * those can be another tenant's drafts. Needs TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { artistNameKey } from '../lib/artist-key';
import { skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

const MANAGE = '/api/v1/manage';
const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});
after(() => {
  if (skip) console.log('organizer-audit-scope: skipped (TEST_DATABASE_URL not set)');
});

async function boot() {
  const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
  servers.push(server);
  const users: any = await o.seedScenario(server);
  return { server, users };
}

describe('the activity view of an organization', { skip }, () => {
  test('does not name the festivals of another tenant that a shared-artist fill rewrote', async () => {
    const { server, users } = await boot();
    const artistId = `sec-artist-${Date.now()}`;
    await o.sql(
      server,
      `INSERT INTO artists (id, name, name_key, label, links, verified) VALUES ($1, 'Secret Share', $2, '', '{}'::jsonb, TRUE)`,
      [artistId, artistNameKey('Secret Share')],
    );
    const lineup = JSON.stringify([{ artists: [{ id: artistId, name: 'Secret Share', links: {} }], displayName: null }]);
    for (const [id, org, published] of [['f-sec-a', 'org-a', false], ['f-sec-b-draft', 'org-b', false], ['f-sec-live', 'org-b', true]] as const) {
      await o.seedFestival(server, id, org, published);
      await o.sql(server, 'UPDATE festivals SET lineup = $2::jsonb WHERE id = $1', [id, lineup]);
    }
    const token = (await o.sql(server, 'SELECT updated_at FROM artists WHERE id = $1', [artistId])).rows[0].updated_at.toISOString();
    const fill = await o.as(server, users.editorA.token).patch(`${MANAGE}/artists/${artistId}`, {
      expectedUpdatedAt: token,
      changes: { addLink: 'https://www.instagram.com/secret_share' },
    });
    assert.equal(fill.status, 200, JSON.stringify(fill.body));
    assert.equal(fill.body.data.flagged, true, 'the fill reached the other tenant, which is the case under test');

    const audit = await o.as(server, users.ownerA.token).get(`${MANAGE}/organizations/org-a/audit`);
    assert.equal(audit.status, 200, JSON.stringify(audit.body));
    const row = audit.body.data.find((entry: any) => entry.action === 'artist.updated');
    assert.ok(row, 'the edit is in the activity view');
    const shown = JSON.stringify(audit.body);
    assert.doesNotMatch(shown, /f-sec-b-draft/);
    assert.doesNotMatch(shown, /festivalsUpdated|festivalIds/);
  });
});
