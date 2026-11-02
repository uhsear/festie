import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, describe, test } from 'node:test';
import { Pool } from 'pg';

import { createAnnouncementsStore } from '../lib/db/stores/announcements.js';

// SQL of the festival announcements store (migration 091). Needs the Docker test DB.

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = !TEST_DATABASE_URL || !TEST_DATABASE_URL.includes('_test');
const SQL = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations', '091_festival_announcements.sql'),
  'utf8',
);

const F1 = 'ann-test-f1';
const F2 = 'ann-test-f2';
const minutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe('announcements store', { skip }, () => {
  let pool: Pool;
  let store: ReturnType<typeof createAnnouncementsStore>;
  let seq = 0;

  const add = (festivalId: string, sendAt: string, over: Record<string, unknown> = {}) =>
    store.create({
      id: `ann-test-${++seq}`,
      festivalId,
      severity: 'info',
      title: 'T',
      body: 'B',
      screen: 'home',
      sendAt,
      createdBy: null,
      ...over,
    });
  const set = (id: string, column: 'sent_at' | 'cancelled_at', at: string) =>
    pool.query(`UPDATE festival_announcements SET ${column} = $2 WHERE id = $1`, [id, at]);

  before(async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
    await pool.query(SQL);
    await pool.query(SQL); // idempotent
    store = createAnnouncementsStore(pool);
    for (const id of [F1, F2]) {
      await pool.query('INSERT INTO festivals (id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [id]);
    }
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM festival_announcements WHERE festival_id IN ($1, $2)', [F1, F2]);
  });

  after(async () => {
    await pool.query('DELETE FROM festivals WHERE id IN ($1, $2)', [F1, F2]).catch(() => {});
    await pool.end();
  });

  test('create maps the row to camelCase with ISO times', async () => {
    const sendAt = minutes(60);
    const a = await add(F1, sendAt, { severity: 'urgent', screen: 'crew', createdBy: 'admin-1' });
    assert.equal(a.festivalId, F1);
    assert.equal(a.severity, 'urgent');
    assert.equal(a.screen, 'crew');
    assert.equal(a.sendAt, sendAt);
    assert.equal(a.sentAt, null);
    assert.equal(a.cancelledAt, null);
    assert.equal(a.recipientCount, null);
    assert.equal(a.createdBy, 'admin-1');
    assert.match(a.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('countNear counts rows under an hour away, not cancelled ones', async () => {
    const t = minutes(600);
    await add(F1, new Date(Date.parse(t) + 59 * 60_000).toISOString());
    await add(F1, new Date(Date.parse(t) - 61 * 60_000).toISOString());
    const cancelled = await add(F1, t);
    await set(cancelled.id, 'cancelled_at', minutes(0));
    await add(F2, t);
    assert.equal(await store.countNear(F1, t), 1);
  });

  test('listActive: sent in 24 h, not cancelled, newest first, at most 3', async () => {
    const ids: string[] = [];
    for (const m of [-10, -20, -30, -40]) {
      const a = await add(F1, minutes(m));
      await set(a.id, 'sent_at', minutes(m));
      ids.push(a.id);
    }
    const old = await add(F1, minutes(-25 * 60));
    await set(old.id, 'sent_at', minutes(-25 * 60));
    const cancelled = await add(F1, minutes(-5));
    await set(cancelled.id, 'sent_at', minutes(-5));
    await set(cancelled.id, 'cancelled_at', minutes(-1));
    await add(F1, minutes(30)); // unsent
    assert.deepEqual(
      (await store.listActive(F1)).map((a) => a.id),
      ids.slice(0, 3),
    );
  });

  test('claimDue twice in parallel returns the due row once', async () => {
    const due = await add(F1, minutes(-1));
    await add(F1, minutes(30));
    const [a, b] = await Promise.all([store.claimDue(), store.claimDue()]);
    const claimed = [...a, ...b].filter((r) => r.festivalId === F1);
    assert.deepEqual(
      claimed.map((r) => r.id),
      [due.id],
    );
    assert.ok(claimed[0]!.sentAt);
  });

  test('expireLate cancels a row 31 minutes late and leaves one 29 minutes late', async () => {
    const late = await add(F1, minutes(-31));
    const onTime = await add(F1, minutes(-29));
    assert.ok((await store.expireLate()) >= 1);
    const claimed = (await store.claimDue()).filter((r) => r.festivalId === F1);
    assert.deepEqual(
      claimed.map((r) => r.id),
      [onTime.id],
    );
    const [row] = (await store.listForAdmin(F1)).filter((r) => r.id === late.id);
    assert.ok(row!.cancelledAt);
    assert.equal(row!.sentAt, null);
  });

  test('cancel is idempotent and scoped to the festival', async () => {
    const a = await add(F1, minutes(60));
    assert.equal(await store.cancel(F2, a.id), null);
    const first = await store.cancel(F1, a.id);
    assert.ok(first?.cancelledAt);
    const second = await store.cancel(F1, a.id);
    assert.equal(second?.cancelledAt, first!.cancelledAt);
  });

  test('setRecipientCount and listForAdmin', async () => {
    const a = await add(F1, minutes(-1));
    await add(F1, minutes(60));
    await store.setRecipientCount(a.id, 450);
    const list = await store.listForAdmin(F1);
    assert.equal(list.length, 2);
    assert.equal(list[1]!.recipientCount, 450);
  });
});
