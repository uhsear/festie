import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { afterEach, describe, test } from 'node:test';
import { Pool } from 'pg';
import { bootServer } from './_boot-server';

// NB: must not contain a common email local-part like "test" — several fixtures
// register with email test@example.com, and checkPasswordPolicy rejects a
// password that contains the email's local-part.
export const DEFAULT_PASSWORD = 'Str0ng!Cipher92';
export const TRUSTED_MUTATION_HEADER = 'x-festie-request';

// ── SAFETY: Only use TEST_DATABASE_URL — never fall back to DATABASE_URL ─
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) { console.error('ERROR: TEST_DATABASE_URL env var required.'); process.exit(1); }
if (!TEST_DATABASE_URL.includes('_test')) { console.error('SAFETY: TEST_DATABASE_URL must contain "_test".'); process.exit(1); }

// ── shared schema / truncate / fixture helpers ───────────────────

async function truncateAllTables() {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  try {
    await pool.query(`
      TRUNCATE TABLE
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

export async function startServer(overrides: any = {}) {
  return bootServer(
    TEST_DATABASE_URL!,
    {
      AUTH_RATE_LIMIT_MAX: 1000,
      // MUST stay empty. A non-empty key — even a fake one — takes sendEmail
      // past its graceful-degrade guard and issues a real HTTPS request to the
      // provider for every registration, reset and verification this suite
      // triggers. '' keeps every send on the `email:skip` path.
      RESEND_API_KEY: '', EMAIL_FROM: 'test@example.com',
      ...overrides,
    },
    () => truncateAllTables(),
  );
}

export async function registerUser(server: any, username: any, password = DEFAULT_PASSWORD, extra: any = {}) {
  const res = await server.request
    .post('/api/v1/auth/register')
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ username, password, confirmPassword: password, dateOfBirth: '1995-01-01', tosAccepted: true, email: `${username}@example.com`, ...extra })
    .expect(201);
  return res.body.data;
}

export const servers: any[] = [];
