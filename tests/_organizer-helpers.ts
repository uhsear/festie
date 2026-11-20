/**
 * Fixtures for the organizer-platform tests: organizations, members and festivals written straight to the
 * test database, and signed-in users with a confirmed (or unconfirmed) email. Imported only by suites that
 * already skip without TEST_DATABASE_URL.
 */
import { Pool } from 'pg';
import { DEFAULT_PASSWORD, TRUSTED_MUTATION_HEADER, loginUser, registerUser } from './_integration-helpers';

export const ADMIN_PASSWORD = 'test-admin-password';

export type TestUser = { id: string; username: string; email: string; token: string };

/** Registers a user and signs in. The email is confirmed unless `confirmed` is false. */
export async function makeUser(server: any, username: string, { confirmed = true } = {}): Promise<TestUser> {
  const registered = await registerUser(server, username);
  const pool = new Pool({ connectionString: server.databaseUrl });
  try {
    if (confirmed) await pool.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [registered.user.id]);
  } finally {
    await pool.end();
  }
  const login = await loginUser(server, username);
  return { id: registered.user.id, username, email: `${username}@example.com`, token: login.token };
}

/** Runs one or more statements on the test database. */
export async function sql(server: any, text: string, params: unknown[] = []) {
  const pool = new Pool({ connectionString: server.databaseUrl });
  try {
    return await pool.query(text, params);
  } finally {
    await pool.end();
  }
}

export const seedOrg = (server: any, id: string, status: 'pending' | 'active' | 'suspended' = 'active', verified = false) =>
  sql(
    server,
    `INSERT INTO organizations (id, name, kind, status, verified_at) VALUES ($1, $2, 'venue', $3, ${verified ? 'NOW()' : 'NULL'})`,
    [id, `Org ${id}`, status],
  );

export const addMember = (server: any, organizationId: string, userId: string, role: 'owner' | 'editor' | 'viewer') =>
  sql(server, 'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)', [organizationId, userId, role]);

export const seedFestival = (server: any, id: string, organizationId: string | null, published = false) =>
  sql(
    server,
    `INSERT INTO festivals (id, name, location, created_at, updated_at, published_at, organization_id, slug)
     VALUES ($1, $2, 'Test Grounds', NOW(), NOW(), ${published ? 'NOW()' : 'NULL'}, $3, $4)`,
    [id, `Fest ${id}`, organizationId, published ? `slug-${id}` : null],
  );

/** Re-enters the password, which destructive routes need within 15 minutes of it. */
export async function reauth(server: any, token: string, password = DEFAULT_PASSWORD) {
  await server.request
    .post('/api/v1/auth/reauth')
    .set('x-user-token', token)
    .set(TRUSTED_MUTATION_HEADER, '1')
    .send({ password })
    .expect(200);
}

/** A request builder for one signed-in caller. Mutations carry the trusted-request header. */
export function as(server: any, token?: string) {
  const call = (method: 'get' | 'put' | 'post' | 'delete', url: string, body?: unknown) => {
    let req = (server.request as any)[method](url).set(TRUSTED_MUTATION_HEADER, '1');
    if (token) req = req.set('x-user-token', token);
    return body === undefined ? req : req.send(body);
  };
  return {
    get: (url: string) => call('get', url),
    put: (url: string, body: unknown = {}) => call('put', url, body),
    post: (url: string, body: unknown = {}) => call('post', url, body),
    delete: (url: string) => call('delete', url),
  };
}

/**
 * The tenants every isolation test uses: organizations A (active), B (active), S (suspended) and P (pending),
 * their festivals, and one signed-in user per role. Call it right after startServer.
 */
export async function seedScenario(server: any) {
  const stamp = Date.now();
  const user = (name: string, opts?: { confirmed?: boolean }) => makeUser(server, `${name}-${stamp}`, opts);
  const [stranger, unconfirmed, viewerA, editorA, ownerA, ownerB, ownerS, ownerP, ghostA] = await Promise.all([
    user('stranger'),
    user('unconfirmed', { confirmed: false }),
    user('viewerA'),
    user('editorA'),
    user('ownerA'),
    user('ownerB'),
    user('ownerS'),
    user('ownerP'),
    user('ghostA'),
  ]);
  await seedOrg(server, 'org-a', 'active');
  await seedOrg(server, 'org-b', 'active');
  await seedOrg(server, 'org-s', 'suspended');
  await seedOrg(server, 'org-p', 'pending');
  await addMember(server, 'org-a', viewerA.id, 'viewer');
  await addMember(server, 'org-a', editorA.id, 'editor');
  await addMember(server, 'org-a', ownerA.id, 'owner');
  await addMember(server, 'org-a', unconfirmed.id, 'owner');
  await addMember(server, 'org-a', ghostA.id, 'owner');
  await addMember(server, 'org-b', ownerB.id, 'owner');
  await addMember(server, 'org-s', ownerS.id, 'owner');
  await addMember(server, 'org-p', ownerP.id, 'owner');
  // A deleted account keeps its membership row but must not act. Its session is left in place on purpose.
  await sql(server, 'UPDATE users SET deleted_at = NOW() WHERE id = $1', [ghostA.id]);
  await seedFestival(server, 'f-a', 'org-a');
  await seedFestival(server, 'f-a-live', 'org-a', true);
  await seedFestival(server, 'f-b', 'org-b');
  await seedFestival(server, 'f-plat', null);
  await seedFestival(server, 'f-s', 'org-s');
  await seedFestival(server, 'f-s-live', 'org-s', true);
  await seedFestival(server, 'f-p', 'org-p');
  await seedFestival(server, 'f-p-live', 'org-p', true);
  return { stranger, unconfirmed, viewerA, editorA, ownerA, ownerB, ownerS, ownerP, ghostA };
}
