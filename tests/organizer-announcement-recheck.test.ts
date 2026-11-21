import 'dotenv/config';
/**
 * A queued announcement of an organization is checked again when it is due: a suspended organization sends
 * nothing, and an organization that lost its verification no longer pushes. Needs TEST_DATABASE_URL.
 */

import assert from 'node:assert/strict';
import { after, afterEach, describe, test } from 'node:test';
import { Pool } from 'pg';
import { createAnnouncementsStore } from '../lib/db/stores/announcements.js';
import { skip } from './_test-schema';

const h: any = skip ? null : await import('./_integration-helpers');
const o: any = skip ? null : await import('./_organizer-helpers');

const servers: any[] = [];
afterEach(async () => {
  while (servers.length > 0) await servers.pop().close();
});
after(() => {
  if (skip) console.log('organizer-announcement-recheck: skipped (TEST_DATABASE_URL not set)');
});

async function boot() {
  const server = await h.startServer({ AUTH_RATE_LIMIT_MAX: 1000 });
  servers.push(server);
  const users: any = await o.seedScenario(server);
  return { server, users };
}

describe('a queued organization announcement is checked again when it is due', { skip }, () => {
  async function queued(server: any, organizationId: string, push: boolean) {
    const festivalId = `f-${organizationId}-live`;
    await o.seedFestival(server, festivalId, organizationId, true);
    const id = `ann-${organizationId}-${push ? 'push' : 'banner'}`;
    await o.sql(
      server,
      `INSERT INTO festival_announcements (id, festival_id, severity, title, body, screen, send_at, push, organization_id)
       VALUES ($1, $2, 'info', 'T', 'B', 'home', NOW() - INTERVAL '1 minute', $3, $4)`,
      [id, festivalId, push, organizationId],
    );
    return id;
  }
  const claim = async (server: any) => {
    const pool = new Pool({ connectionString: server.databaseUrl });
    try {
      return await createAnnouncementsStore(pool).claimDue(50);
    } finally {
      await pool.end();
    }
  };

  test('a suspended organization sends nothing, and the row stays unsent', async () => {
    const { server } = await boot();
    const id = await queued(server, 'org-s', true);
    assert.deepEqual((await claim(server)).map((row: any) => row.id), []);
    assert.equal((await o.sql(server, 'SELECT sent_at FROM festival_announcements WHERE id = $1', [id])).rows[0].sent_at, null);
  });

  test('an organization that is not verified any more shows the banner without a push', async () => {
    const { server } = await boot();
    await o.sql(server, "UPDATE organizations SET verified_at = NULL WHERE id = 'org-a'");
    const id = await queued(server, 'org-a', true);
    const claimed = await claim(server);
    assert.deepEqual(claimed.map((row: any) => [row.id, row.push]), [[id, false]]);
  });

  test('a verified active organization and a platform announcement still push', async () => {
    const { server } = await boot();
    await o.sql(server, "UPDATE organizations SET verified_at = NOW() WHERE id = 'org-a'");
    const verified = await queued(server, 'org-a', true);
    await o.seedFestival(server, 'f-platform-live', null, true);
    await o.sql(
      server,
      `INSERT INTO festival_announcements (id, festival_id, severity, title, body, screen, send_at, push)
       VALUES ('ann-platform', 'f-platform-live', 'info', 'T', 'B', 'home', NOW() - INTERVAL '1 minute', TRUE)`,
    );
    const claimed = await claim(server);
    assert.deepEqual(claimed.map((row: any) => [row.id, row.push]).sort(), [[verified, true], ['ann-platform', true]]);
  });
});
