/**
 * Critical Path Integration Tests
 * Covers: Admin festival CRUD, avatar lifecycle, HTML/ICS export,
 *         Redis-unavailable fallback, Prometheus metrics format,
 *         session expiration mid-use
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import request from 'supertest';
import { DEFAULT_PASSWORD, TRUSTED_MUTATION_HEADER, AVATAR_FIXTURE, startServer, registerUser, joinFestival, loginAdmin, reauthAdmin, servers } from './_critical-paths-helpers';

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop();
    await s.close();
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// 1. Admin Festival CRUD
// ════════════════════════════════════════════════════════════════════════════════

describe('admin festival CRUD', { concurrency: 1 }, () => {
  test('admin can create a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const festivalPayload = {
      name: 'New Fest 2026',
      location: 'Miami',
      stages: [{ id: 'main-new', name: 'Main', color: '#ff0000' }],
      days: [
        {
          label: 'Day 1',
          date: '2026-07-01',
          sets: [{ id: 'set-new-1', artist: 'TestDJ', stageId: 'main-new', startTime: '20:00', endTime: '21:00' }],
        },
      ],
    };

    const res = await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send(festivalPayload)
      .expect(201);

    assert.equal(res.body.data.name, 'New Fest 2026');
    assert.equal(res.body.data.location, 'Miami');
    assert.ok(res.body.data.id, 'Created festival should have an id');
    assert.ok(res.body.data.stages.length >= 1);
    assert.ok(res.body.data.days.length >= 1);
  });

  test('admin can update a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const res = await server.request
      .put('/api/v1/admin/festivals/fest-1')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({
        name: 'Updated Fest',
        location: 'New Location',
        stages: [{ id: 'big', name: 'Big Stage', color: '#00ff00' }],
        days: [
          {
            label: 'Friday',
            date: '2026-06-05',
            sets: [{ id: 'set-upd-1', artist: 'NewArtist', stageId: 'big', startTime: '10:00', endTime: '11:00' }],
          },
        ],
      })
      .expect(200);

    assert.equal(res.body.data.name, 'Updated Fest');
    assert.equal(res.body.data.location, 'New Location');

    // Verify the update persisted
    const getRes = await server.request.get('/api/v1/festivals/fest-1').expect(200);
    assert.equal(getRes.body.data.name, 'Updated Fest');
  });

  test('admin can soft-delete a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);
    await reauthAdmin(server, adminToken);

    await server.request
      .delete('/api/v1/admin/festivals/fest-1')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Festival should no longer appear in list
    const listRes = await server.request.get('/api/v1/festivals').expect(200);
    const ids = listRes.body.data.map((f: any) => f.id);
    assert.ok(!ids.includes('fest-1'), 'Soft-deleted festival should not appear in list');
  });

  test('admin can hard-delete a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);
    await reauthAdmin(server, adminToken);

    await server.request
      .delete('/api/v1/admin/festivals/fest-1?hard=true')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // Festival detail should 404
    await server.request.get('/api/v1/festivals/fest-1').expect(404);
  });

  test('non-admin cannot create a festival', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'regularuser');

    await server.request
      .post('/api/v1/admin/festivals')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ name: 'Hack Fest', location: 'Nowhere', stages: [], days: [] })
      .expect(403);
  });

  test('delete nonexistent festival returns 404', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);
    await reauthAdmin(server, adminToken);

    await server.request
      .delete('/api/v1/admin/festivals/nonexistent-fest')
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(404);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. Admin User Management
// ════════════════════════════════════════════════════════════════════════════════

describe('admin user management', { concurrency: 1 }, () => {
  test('admin can list users with profile counts', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    // Create a user and join a festival
    const user = await registerUser(server, 'alice');
    await joinFestival(server, user.token);

    const res = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);

    assert.ok(Array.isArray(res.body.data));
    const alice = res.body.data.find((u: any) => u.username === 'alice');
    assert.ok(alice, 'alice should appear in user list');
    assert.equal(alice.profileCount, 1);
  });

  test('admin can reset a user password', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);
    await registerUser(server, 'bob');

    // Get bob's user id
    const usersRes = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);
    const bob = usersRes.body.data.find((u: any) => u.username === 'bob');

    await reauthAdmin(server, adminToken);
    await server.request
      .put(`/api/v1/admin/users/${bob.id}/reset-password`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ newPassword: 'newpassword999' })
      .expect(200);

    // Old password should fail
    await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'bob', password: DEFAULT_PASSWORD })
      .expect(401);

    // New password should work
    await server.request
      .post('/api/v1/auth/login')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .send({ username: 'bob', password: 'newpassword999' })
      .expect(200);
  });

  test('admin can delete a user and cascade cleans up', async () => {
    const server = await startServer();
    servers.push(server);
    const adminToken = await loginAdmin(server);

    const user = await registerUser(server, 'doomed');
    await joinFestival(server, user.token);

    const usersRes = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);
    const doomed = usersRes.body.data.find((u: any) => u.username === 'doomed');

    await reauthAdmin(server, adminToken);
    await server.request
      .delete(`/api/v1/admin/users/${doomed.id}`)
      .set('x-user-token', adminToken)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    // User should no longer appear
    const afterRes = await server.request
      .get('/api/v1/admin/users')
      .set('x-user-token', adminToken)
      .expect(200);
    const found = afterRes.body.data.find((u: any) => u.username === 'doomed');
    assert.ok(!found, 'Deleted user should not appear in list');

    // Token should be invalid
    await server.request
      .post('/api/v1/auth/verify')
      .set('x-user-token', user.token)
      .expect(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. Avatar Upload & Removal Lifecycle
// ════════════════════════════════════════════════════════════════════════════════

describe('avatar lifecycle', { concurrency: 1 }, () => {
  test('upload avatar, verify URL, then delete', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'avataruser');

    // Upload avatar
    const uploadRes = await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(200);

    // Response may be nested as data.user.avatarUrl or data.avatarUrl
    const avatarUrl = uploadRes.body.data?.avatarUrl || uploadRes.body.data?.user?.avatarUrl;
    assert.ok(avatarUrl, 'Should return avatar URL');

    // Verify avatar URL is served
    if (avatarUrl && avatarUrl.startsWith('/')) {
      await server.request.get(avatarUrl).expect(200);
    }

    // Delete avatar
    const deleteRes = await server.request
      .delete('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .expect(200);

    const deletedAvatarUrl = deleteRes.body.data?.avatarUrl ?? deleteRes.body.data?.user?.avatarUrl ?? null;
    assert.equal(deletedAvatarUrl, null);
  });

  test('rejects non-image upload', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'badupload');

    await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', Buffer.from('not an image at all'), {
        filename: 'malicious.exe',
        contentType: 'application/octet-stream',
      })
      .expect(400);
  });

  test('rejects oversized upload', async () => {
    const server = await startServer({ AVATAR_MAX_UPLOAD_BYTES: 100 });
    servers.push(server);
    const user = await registerUser(server, 'bigupload');

    // 200 bytes > 100 byte limit
    await server.request
      .post('/api/v1/account/avatar')
      .set('x-user-token', user.token)
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', Buffer.alloc(200), { filename: 'big.png', contentType: 'image/png' })
      .expect(400);
  });

  test('requires auth for avatar upload', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request
      .post('/api/v1/account/avatar')
      .set(TRUSTED_MUTATION_HEADER, '1')
      .attach('avatar', AVATAR_FIXTURE, { filename: 'avatar.png', contentType: 'image/png' })
      .expect(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. HTML & ICS Export
// ════════════════════════════════════════════════════════════════════════════════

describe('export', { concurrency: 1 }, () => {
  test('HTML export returns valid HTML with festival data', async () => {
    const server = await startServer();
    servers.push(server);
    const user = await registerUser(server, 'exporter');
    const profile = await joinFestival(server, user.token);

    const res = await server.request
      .get(`/api/v1/export/fest-1/${profile.id}`)
      .set('x-user-token', user.token)
      .expect(200);

    assert.match(res.headers['content-type']!, /text\/html/);
    assert.match(res.text, /<!DOCTYPE html>/i);
  });

  test('export requires auth', async () => {
    const server = await startServer();
    servers.push(server);

    await server.request.get('/api/v1/export/fake-fest/fake-profile').expect(401);
  });
});
