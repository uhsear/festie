import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, after as afterAll, describe, test } from 'node:test';
import { Pool } from 'pg';
import { io as createSocketClient } from 'socket.io-client';
import { bootServer } from './_boot-server';

export const DEFAULT_PASSWORD = 'Str0ngTest!Pw';
export const TRUSTED_MUTATION_HEADER = 'x-festie-request';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) { console.error('ERROR: TEST_DATABASE_URL env var required.'); process.exit(1); }
if (!TEST_DATABASE_URL.includes('_test')) { console.error('SAFETY: TEST_DATABASE_URL must contain "_test".'); process.exit(1); }

// ── fixtures ─────────────────────────────────────────────────────

function createFestivalFixture() {
  return [{
    id: 'fest-1', name: 'Test Fest', location: 'Test Grounds',
    stages: [
      { id: 'main', name: 'Main Stage', color: '#ff3366' },
      { id: 'forest', name: 'Forest Stage', color: '#00e8d0' },
    ],
    days: [
      {
        label: 'Friday', date: '2026-06-05',
        sets: [
          { id: 'set-a', artist: 'Alpha', stageId: 'main', startTime: '10:00', endTime: '11:00' },
          { id: 'set-b', artist: 'Beta', stageId: 'forest', startTime: '10:30', endTime: '11:30' },
          { id: 'set-c', artist: 'Gamma', stageId: 'main', startTime: '12:00', endTime: '13:00' },
        ],
      },
      {
        label: 'Saturday', date: '2026-06-06',
        sets: [
          { id: 'set-d', artist: 'Delta', stageId: 'forest', startTime: '14:00', endTime: '15:00' },
        ],
      },
    ],
  }, {
    id: 'fest-p2', name: 'Phase2 Fest', location: 'Test Grounds',
    stages: [
      { id: 'main', name: 'Main Stage', color: '#ff3366' },
      { id: 'forest', name: 'Forest', color: '#33ff66' },
    ],
    days: [{
      label: 'Saturday', date: '2026-06-06',
      sets: [
        { id: 'set-1', artist: 'Excision', stageId: 'main', startTime: '22:00', endTime: '23:30' },
        { id: 'set-2', artist: 'Kompany', stageId: 'forest', startTime: '20:00', endTime: '21:00' },
        { id: 'set-3', artist: 'HVDES', stageId: 'main', startTime: '18:00', endTime: '19:00' },
      ],
    }],
  }];
}

async function truncateAllTables() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(`
      TRUNCATE TABLE
        crew_poll_votes, crew_polls,
        email_verification_tokens, password_reset_tokens,
        audit_log, notification_topic_subs, notification_counts, notification_log,
        notification_preferences, device_tokens,
        crew_members, crews, festival_profile_notes,
        festival_profile_picks, festival_profiles, festival_sets, festival_days,
        festival_stages, festivals, user_sessions, users
      CASCADE
    `);
  } finally { await pool.end(); }
}

async function seedTestData(festivals = createFestivalFixture()) {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    for (const festival of festivals) {
      await pool.query(
        'INSERT INTO festivals (id, name, location, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT (id) DO NOTHING',
        [festival.id, festival.name, festival.location]
      );
      for (let si = 0; si < (festival.stages || []).length; si++) {
        const stage = festival.stages[si]!;
        await pool.query(
          'INSERT INTO festival_stages (festival_id, id, name, color, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [festival.id, stage.id, stage.name, stage.color, si]
        );
      }
      for (let di = 0; di < (festival.days || []).length; di++) {
        const day = festival.days[di]!;
        await pool.query(
          'INSERT INTO festival_days (festival_id, day_index, label, date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
          [festival.id, di, day.label, day.date]
        );
        for (let sei = 0; sei < (day.sets || []).length; sei++) {
          const set = day.sets[sei]!;
          await pool.query(
            'INSERT INTO festival_sets (id, festival_id, day_index, artist, stage_id, start_time, end_time, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING',
            [set.id, festival.id, di, set.artist, set.stageId, set.startTime, set.endTime, sei]
          );
        }
      }
    }
  } finally { await pool.end(); }
}

export async function startServer(overrides: any = {}) {
  return bootServer(
    TEST_DATABASE_URL!,
    { AUTH_RATE_LIMIT_MAX: 1000, RESEND_API_KEY: 'test_fake_key', EMAIL_FROM: 'test@example.com', ...overrides },
    async () => {
      await truncateAllTables();
      await seedTestData();
    },
  );
}

export async function registerUser(server: any, username: any, password = DEFAULT_PASSWORD) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password, confirmPassword: password, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${username}@example.com` })
    .expect(201);
  return res.body.data;
}

export async function joinFestival(server: any, userToken: any, festivalId = 'fest-1') {
  const res = await server.request
    .post('/api/v1/profiles')
    .set('x-user-token', userToken)
    .send({ festivalId })
    .expect(200);
  return res.body.data;
}

export async function createCrew(server: any, token: any, name = 'Test Crew', festivalId = 'fest-p2') {
  const res = await server.request
    .post('/api/v1/crews')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ name, festivalId })
    .expect(201);
  return res.body.data;
}

export async function joinCrew(server: any, token: any, inviteCode: any) {
  const res = await server.request
    .post('/api/v1/crews/join')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ inviteCode })
    .expect(200);
  return res.body.data;
}

export async function loginAdmin(server: any) {
  const adminUsername = 'testadmin-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username: adminUsername, password: 'test-admin-password-pass', confirmPassword: 'test-admin-password-pass', dateOfBirth: '1995-01-01', tosAccepted: true, email: `${adminUsername}@example.com` })
    .expect(201);
  const pool = new Pool({ connectionString: server.databaseUrl, statement_timeout: 5000 });
  try {
    await pool.query(
      'INSERT INTO user_roles (user_id, role_id, granted_by, granted_at) SELECT u.id, r.id, NULL, NOW() FROM users u, roles r WHERE u.username = $1 AND r.name = $2 ON CONFLICT (user_id, role_id) DO NOTHING',
      [adminUsername, 'admin']
    );
  } finally { await pool.end(); }
  const loginRes = await server.request
    .post('/api/v1/auth/login')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username: adminUsername, password: 'test-admin-password-pass' })
    .expect(200);
  return loginRes.body.data.token;
}

// Festival delete needs a password re-entry within 15 minutes (requireRecentAuth).
export async function reauthAdmin(server: any, adminToken: string) {
  await server.request
    .post('/api/v1/auth/reauth')
    .set('x-user-token', adminToken)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ password: 'test-admin-password-pass' })
    .expect(200);
}

export const servers: any[] = [];
