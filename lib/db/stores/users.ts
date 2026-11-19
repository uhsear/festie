// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { Pool } from 'pg';
import { withTransaction } from '../connection';
import { buildUpdate } from '../utils';

export default function createUsersStore(pool: Pool, utils: any) {
  const { toISOString } = utils;

  const COLUMN_MAP: Record<string, string> = {
    username: 'username',
    displayName: 'display_name',
    email: 'email',
    passwordHash: 'password_hash',
    avatarKey: 'avatar_key',
    avatarVersion: 'avatar_version',
    avatarUpdatedAt: 'avatar_updated_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
    tosAcceptedAt: 'tos_accepted_at',
    tosVersion: 'tos_version',
    emailVerifiedAt: 'email_verified_at',
    venmoHandle: 'venmo_handle',
    cashappCashtag: 'cashapp_cashtag',
    paypalHandle: 'paypal_handle',
    publicSchedule: 'public_schedule',
  };

  const ALLOWED_UPDATE_KEYS = new Set([...Object.keys(COLUMN_MAP), ...Object.values(COLUMN_MAP)]);

  function toColumn(key: string): string {
    if (!ALLOWED_UPDATE_KEYS.has(key)) throw new Error(`Invalid column key: ${key}`);
    return COLUMN_MAP[key] || key;
  }

  const USER_COLUMNS = `
    id, username, email,
    display_name AS "displayName",
    password_hash AS "passwordHash",
    avatar_key AS "avatarKey",
    avatar_version AS "avatarVersion",
    avatar_updated_at AS "avatarUpdatedAt",
    tos_accepted_at AS "tosAcceptedAt",
    tos_version AS "tosVersion",
    email_verified_at AS "emailVerifiedAt",
    venmo_handle AS "venmoHandle",
    cashapp_cashtag AS "cashappCashtag",
    paypal_handle AS "paypalHandle",
    public_schedule AS "publicSchedule",
    date_of_birth AS "dateOfBirth",
    created_at AS "createdAt",
    updated_at AS "updatedAt",
    deleted_at AS "deletedAt"
  `;

  function normalizeRow(row: any) {
    if (!row) return null;
    return {
      ...row,
      displayName: row.displayName || null,
      avatarKey: row.avatarKey || null,
      avatarVersion: row.avatarVersion || null,
      avatarUpdatedAt: toISOString(row.avatarUpdatedAt) || null,
      tosAcceptedAt: toISOString(row.tosAcceptedAt) || null,
      tosVersion: row.tosVersion || null,
      createdAt: toISOString(row.createdAt),
      updatedAt: toISOString(row.updatedAt) || null,
      deletedAt: toISOString(row.deletedAt) || null,
      email: row.email || null,
      emailVerifiedAt: toISOString(row.emailVerifiedAt) || null,
      venmoHandle: row.venmoHandle || null,
      cashappCashtag: row.cashappCashtag || null,
      paypalHandle: row.paypalHandle || null,
      publicSchedule: row.publicSchedule === true,
      dateOfBirth: row.dateOfBirth || null,
    };
  }

  const users: any = {
    async readAll() {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC`,
      );
      return result.rows.map(normalizeRow);
    },

    async getById(userId: string) {
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`, [
        userId,
      ]);
      return normalizeRow(result.rows[0]);
    },

    async getByIds(userIds: string[]) {
      if (!userIds || userIds.length === 0) return new Map();
      const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1) AND deleted_at IS NULL`, [
        userIds,
      ]);
      const map = new Map();
      for (const row of result.rows) {
        map.set(row.id, normalizeRow(row));
      }
      return map;
    },

    async getByUsername(username: string) {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`,
        [username],
      );
      return normalizeRow(result.rows[0]);
    },

    // Caller lower-cases the address; deleted accounts are excluded on purpose.
    async getByEmail(email: string) {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL LIMIT 1`,
        [email],
      );
      return normalizeRow(result.rows[0]);
    },

    // A soft-deleted account still inside its 30-day grace window. The bound
    // matches the copy even if the pg_cron purge runs late.
    async findDeletedByUsername(username: string) {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE username = $1 AND deleted_at IS NOT NULL AND deleted_at > NOW() - INTERVAL '30 days' LIMIT 1`,
        [username],
      );
      return normalizeRow(result.rows[0]);
    },

    async findDeletedByEmail(email: string) {
      const result = await pool.query(
        `SELECT ${USER_COLUMNS} FROM users WHERE LOWER(email) = $1 AND deleted_at IS NOT NULL AND deleted_at > NOW() - INTERVAL '30 days' ORDER BY deleted_at DESC LIMIT 1`,
        [email],
      );
      return normalizeRow(result.rows[0]);
    },

    // `update` filters `deleted_at IS NULL`, so it cannot clear a soft delete.
    async reactivate(userId: string) {
      await pool.query(
        'UPDATE users SET deleted_at = NULL, deleted_by = NULL, deletion_reason = NULL, updated_at = NOW() WHERE id = $1 AND deleted_at IS NOT NULL',
        [userId],
      );
    },

    async softDelete(userId: string, { deletedBy, reason }: { deletedBy?: string; reason?: string } = {}) {
      await pool.query(
        'UPDATE users SET deleted_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL',
        [userId, deletedBy || null, reason || null],
      );
    },

    async purgeDeleted(daysOld: any) {
      const days = Math.max(0, parseInt(daysOld, 10));
      if (isNaN(days)) return;
      await pool.query(
        `DELETE FROM users WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '1 day' * $1`,
        [days],
      );
    },

    async create({ id, username, passwordHash, email, dateOfBirth, createdAt, tosAcceptedAt, tosVersion, emailVerifiedAt }: any) {
      await pool.query(
        'INSERT INTO users (id, username, password_hash, email, date_of_birth, created_at, tos_accepted_at, tos_version, email_verified_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
        [
          id,
          username,
          passwordHash,
          email || null,
          dateOfBirth || null,
          createdAt || new Date().toISOString(),
          tosAcceptedAt || null,
          tosVersion || null,
          emailVerifiedAt || null,
        ],
      );
      return this.getById(id);
    },

    async update(userId: string, fields: Record<string, any>) {
      const sets: Array<[string, unknown]> = Object.entries(fields).map(([key, val]) => [toColumn(key), val]);
      sets.push(['updated_at', new Date().toISOString()]);
      const q = buildUpdate('users', sets, userId, { extraWhere: 'deleted_at IS NULL', returning: USER_COLUMNS });
      const result = await pool.query(q.text, q.values);
      return normalizeRow(result.rows[0]);
    },

    async delete(userId: string, { deletedBy, reason }: { deletedBy?: string; reason?: string } = {}) {
      const user = await this.getById(userId);
      if (!user) return null;
      await pool.query(
        'UPDATE users SET deleted_at = NOW(), updated_at = NOW(), deleted_by = $2, deletion_reason = $3 WHERE id = $1 AND deleted_at IS NULL',
        [userId, deletedBy || null, reason || null],
      );
      return user;
    },

    async hardDelete(userId: string) {
      // Migration 031 changed all user FKs from CASCADE to RESTRICT,
      // so we must delete child rows explicitly inside a transaction.
      return withTransaction(pool, async (client) => {
        await client.query('DELETE FROM set_ratings WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_topic_subs WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_preferences WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_log WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM notification_counts WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM device_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM calendar_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM festival_profiles WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM crew_poll_votes WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM crew_polls WHERE created_by = $1', [userId]);
        await client.query('DELETE FROM crew_meeting_points WHERE created_by = $1', [userId]);
        await client.query('DELETE FROM crew_members WHERE user_id = $1', [userId]);
        // crew_member_status.user_id has no FK to users (migration 051) — RESTRICT
        // wouldn't even block this delete, the rows (incl. GPS/ETA breadcrumbs) would
        // just orphan silently, so purge explicitly.
        await client.query('DELETE FROM crew_member_status WHERE user_id = $1', [userId]);
        // Keep the expenses so the other members' balances stay put; migration 116 seeds the placeholder.
        await client.query("UPDATE crew_expenses SET paid_by = 'deleted-user' WHERE paid_by = $1", [userId]);
        await client.query('DELETE FROM crew_activity WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM login_failures WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);

        // Crews the user created are ON DELETE RESTRICT (migration 031, deliberate —
        // a user deletion must not silently destroy a crew that other members are in).
        // Transfer ownership to the longest-standing remaining member; delete the crew
        // only if the departing user was its sole member (crew_id children all cascade).
        // Runs before the user row is deleted so created_by no longer references it.
        const { rows: ownedCrews } = await client.query('SELECT id FROM crews WHERE created_by = $1', [
          userId,
        ]);
        for (const owned of ownedCrews) {
          const { rows: heirs } = await client.query(
            `
  SELECT
    cm.user_id
  FROM
    crew_members cm
    JOIN users u ON u.id = cm.user_id
    AND u.deleted_at IS NULL
  WHERE
    cm.crew_id = $1
    AND cm.user_id <> $2
  ORDER BY
    cm.joined_at ASC
  LIMIT
    1
`,
            [owned.id, userId],
          );
          if (heirs[0]) {
            await client.query('UPDATE crews SET created_by = $1, updated_at = NOW() WHERE id = $2', [
              heirs[0].user_id,
              owned.id,
            ]);
            await client.query("UPDATE crew_members SET role = 'owner' WHERE crew_id = $1 AND user_id = $2", [
              owned.id,
              heirs[0].user_id,
            ]);
          } else {
            await client.query('DELETE FROM crews WHERE id = $1', [owned.id]);
          }
        }

        const { rows } = await client.query('DELETE FROM users WHERE id = $1 RETURNING *', [userId]);
        return rows[0] ? normalizeRow(rows[0]) : null;
      });
    },

    async count() {
      const { rows } = await pool.query('SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL');
      return parseInt(rows[0]?.count ?? 0, 10);
    },

    countActive: (...args: any[]) => users.count(...args),
  };

  return users;
}
