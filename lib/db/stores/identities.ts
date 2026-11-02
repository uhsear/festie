import type { Pool, PoolClient } from 'pg';

export type IdentityProvider = 'google' | 'apple';
export type OAuthStateKind = 'nonce' | 'signup' | 'token';

/** The public shape of an identity. The encrypted Apple token is never part of it. */
export interface Identity {
  id: string;
  userId: string;
  provider: IdentityProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

type Db = Pick<Pool | PoolClient, 'query'>;

const PUBLIC_COLUMNS = `id, user_id, provider, subject, email, email_verified, is_private_email, created_at, last_used_at`;

const iso = (v: Date | string | null) => (v ? new Date(v).toISOString() : null);

function toIdentity(row: any): Identity {
  return {
    id: String(row.id),
    userId: row.user_id,
    provider: row.provider,
    subject: row.subject,
    email: row.email,
    emailVerified: row.email_verified,
    isPrivateEmail: row.is_private_email,
    createdAt: iso(row.created_at) as string,
    lastUsedAt: iso(row.last_used_at),
  };
}

export function createIdentitiesStore(pool: Pool) {
  return {
    async findBySubject(provider: IdentityProvider, subject: string): Promise<Identity | null> {
      const { rows } = await pool.query(
        `SELECT ${PUBLIC_COLUMNS} FROM user_identities WHERE provider = $1 AND subject = $2`,
        [provider, subject],
      );
      return rows[0] ? toIdentity(rows[0]) : null;
    },

    async listByUser(userId: string): Promise<Identity[]> {
      const { rows } = await pool.query(
        `SELECT ${PUBLIC_COLUMNS} FROM user_identities WHERE user_id = $1 ORDER BY created_at, id`,
        [userId],
      );
      return rows.map(toIdentity);
    },

    /** A duplicate (provider, subject) or (user_id, provider) raises 23505 to the caller. */
    async create({
      userId,
      provider,
      subject,
      email = null,
      emailVerified = false,
      isPrivateEmail = false,
      appleRefreshTokenEnc = null,
    }: {
      userId: string;
      provider: IdentityProvider;
      subject: string;
      email?: string | null;
      emailVerified?: boolean;
      isPrivateEmail?: boolean;
      appleRefreshTokenEnc?: string | null;
    }): Promise<Identity> {
      const { rows } = await pool.query(
        `INSERT INTO user_identities (user_id, provider, subject, email, email_verified, is_private_email, apple_refresh_token_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${PUBLIC_COLUMNS}`,
        [userId, provider, subject, email, emailVerified, isPrivateEmail, appleRefreshTokenEnc],
      );
      return toIdentity(rows[0]);
    },

    /** Stamp a sign-in; a new Apple token replaces the stored one, a missing one keeps it. */
    async touch(id: string, appleRefreshTokenEnc?: string | null): Promise<void> {
      await pool.query(
        `
  UPDATE user_identities
  SET
    last_used_at = NOW(),
    apple_refresh_token_enc = COALESCE($2, apple_refresh_token_enc)
  WHERE
    id = $1
`,
        [id, appleRefreshTokenEnc ?? null],
      );
    },

    /**
     * Delete one identity and return it with its encrypted Apple token, or null.
     * Pass the transaction client to run it under the countSignInMethods lock.
     */
    async deleteForUser(
      userId: string,
      provider: IdentityProvider,
      db: Db = pool,
    ): Promise<(Identity & { appleRefreshTokenEnc: string | null }) | null> {
      const { rows } = await db.query(
        `DELETE FROM user_identities WHERE user_id = $1 AND provider = $2
         RETURNING ${PUBLIC_COLUMNS}, apple_refresh_token_enc`,
        [userId, provider],
      );
      return rows[0] ? { ...toIdentity(rows[0]), appleRefreshTokenEnc: rows[0].apple_refresh_token_enc } : null;
    },

    async appleTokensForUser(userId: string): Promise<Array<{ id: string; appleRefreshTokenEnc: string }>> {
      const { rows } = await pool.query(
        `
  SELECT
    id,
    apple_refresh_token_enc
  FROM
    user_identities
  WHERE
    user_id = $1
    AND provider = 'apple'
    AND apple_refresh_token_enc IS NOT NULL
`,
        [userId],
      );
      return rows.map((r: any) => ({ id: String(r.id), appleRefreshTokenEnc: r.apple_refresh_token_enc }));
    },

    /**
     * Sign-in methods left: (password set ? 1 : 0) + identities. Call it inside a
     * transaction with that transaction's client: the users row lock stops two
     * parallel unlinks from both passing the "not the last method" check.
     */
    async countSignInMethods(client: Db, userId: string): Promise<number> {
      const user = await client.query(
        'SELECT (password_hash IS NOT NULL)::int AS has_password FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!user.rows[0]) return 0;
      const ids = await client.query('SELECT COUNT(*)::int AS n FROM user_identities WHERE user_id = $1', [userId]);
      return user.rows[0].has_password + ids.rows[0].n;
    },

    // ── auth_oauth_states: issued nonces, pending sign-ups, used ID tokens ──

    // A null payload is stored as {} so takeState can tell "taken" from "absent".
    async putState(kind: OAuthStateKind, keyHash: string, payload: unknown, ttlSeconds: number): Promise<void> {
      await pool.query(
        `
  INSERT INTO
    auth_oauth_states (key_hash, kind, payload, expires_at)
  VALUES
    ($1, $2, $3, NOW() + make_interval(secs => $4))
`,
        [keyHash, kind, JSON.stringify(payload ?? {}), ttlSeconds],
      );
    },

    /** Atomic single use: the first caller gets the payload, every later caller null. */
    async takeState<T = Record<string, unknown>>(kind: OAuthStateKind, keyHash: string): Promise<T | null> {
      const { rows } = await pool.query(
        'DELETE FROM auth_oauth_states WHERE key_hash = $1 AND kind = $2 AND expires_at > NOW() RETURNING payload',
        [keyHash, kind],
      );
      return rows[0] ? (rows[0].payload as T) : null;
    },

    /**
     * Record an accepted ID token until it expires. Returns true the first time
     * only. `expSeconds` is the token's `exp`; the row outlives it by five
     * minutes so a replay inside verify's 60 s clock tolerance still hits it.
     */
    async markTokenUsed(keyHash: string, expSeconds: number): Promise<boolean> {
      const { rowCount } = await pool.query(
        `INSERT INTO auth_oauth_states (key_hash, kind, payload, expires_at)
         VALUES ($1, 'token', NULL, to_timestamp($2) + INTERVAL '5 minutes')
         ON CONFLICT (key_hash) DO NOTHING`,
        [keyHash, expSeconds],
      );
      return rowCount === 1;
    },

    async purgeExpiredStates(): Promise<number> {
      const { rowCount } = await pool.query('DELETE FROM auth_oauth_states WHERE expires_at < NOW()');
      return rowCount ?? 0;
    },
  };
}
