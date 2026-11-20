// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Organizations, their members and pending (by-email) members (migration 108).
 * A member counts only while the user is not deleted and has a confirmed email, so every lookup
 * here joins `users` with that rule. Nothing is cached: a removal takes effect on the next request.
 */

import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../connection.js';

export type OrgRole = 'owner' | 'editor' | 'viewer';
export type OrgStatus = 'pending' | 'active' | 'suspended';

/** A refusal the route maps to a status code. `code` is a key of ErrorCodes. */
export class OrganizationError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'INVALID_INPUT' | 'FORBIDDEN',
  ) {
    super(message);
    this.name = 'OrganizationError';
  }
}

const ORG_COLUMNS = `
  o.id,
  o.name,
  o.kind,
  o.website,
  o.status,
  o.verified_at AS "verifiedAt",
  o.created_by AS "createdBy",
  o.created_at AS "createdAt",
  o.updated_at AS "updatedAt"
`;

/** What an organizer sees in place of the name of anyone outside the organization, an admin included. */
export const SUPPORT_LABEL = 'Festie support';

// The one rule for "this user may act as a member": not deleted, email confirmed.
const ACTIVE_USER = 'u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL';

export type OrganizationCreate = {
  id: string;
  name: string;
  kind: 'venue' | 'promoter' | 'other';
  website?: string | null;
  status: OrgStatus;
  createdBy: string | null;
};

export function createOrganizationsStore(pool: Pool) {
  async function requireOrg(client: PoolClient, organizationId: string) {
    const { rows } = await client.query('SELECT id FROM organizations WHERE id = $1 FOR UPDATE', [organizationId]);
    if (!rows[0]) throw new OrganizationError(404, 'Organization not found.', 'NOT_FOUND');
  }

  // Locks the member rows of the organization so two concurrent demotions cannot both pass the last-owner check.
  // Returns the role of the target and how many other owners could still act.
  async function lockOwners(client: PoolClient, organizationId: string, userId: string) {
    const { rows } = await client.query(
      `SELECT m.user_id, m.role, (${ACTIVE_USER}) AS active
         FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        FOR UPDATE OF m`,
      [organizationId],
    );
    const target = rows.find((r: any) => r.user_id === userId);
    const otherActiveOwners = rows.filter((r: any) => r.user_id !== userId && r.role === 'owner' && r.active).length;
    return { target: target ? (target.role as OrgRole) : null, otherActiveOwners };
  }

  return {
    async create(org: OrganizationCreate) {
      const { rows } = await pool.query(
        `INSERT INTO organizations (id, name, kind, website, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, kind, website, status, verified_at AS "verifiedAt", created_by AS "createdBy",
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        [org.id, org.name, org.kind, org.website ?? null, org.status, org.createdBy],
      );
      return rows[0];
    },

    async getById(organizationId: string) {
      const { rows } = await pool.query(`SELECT ${ORG_COLUMNS} FROM organizations o WHERE o.id = $1`, [organizationId]);
      return rows[0] ?? null;
    },

    /** Every organization with counts. `ownerless` keeps the ones with no active owner. */
    async list({ status, ownerless }: { status?: OrgStatus; ownerless?: boolean } = {}) {
      const { rows } = await pool.query(
        `SELECT ${ORG_COLUMNS},
           (SELECT COUNT(*)::int FROM organization_members m WHERE m.organization_id = o.id) AS "memberCount",
           (SELECT COUNT(*)::int FROM organization_pending_members p WHERE p.organization_id = o.id) AS "pendingCount",
           (SELECT COUNT(*)::int FROM festivals f WHERE f.organization_id = o.id AND f.deleted_at IS NULL) AS "festivalCount",
           (SELECT COUNT(*)::int FROM organization_members m JOIN users u ON u.id = m.user_id
             WHERE m.organization_id = o.id AND m.role = 'owner' AND ${ACTIVE_USER}) AS "ownerCount"
         FROM organizations o
         WHERE ($1::text IS NULL OR o.status = $1)
         ORDER BY o.created_at DESC, o.id
         LIMIT 500`,
        [status ?? null],
      );
      return ownerless ? rows.filter((r: any) => r.ownerCount === 0) : rows;
    },

    async setStatus(organizationId: string, status: OrgStatus) {
      const { rows } = await pool.query(
        `UPDATE organizations o SET status = $2, updated_at = NOW() WHERE o.id = $1 RETURNING ${ORG_COLUMNS}`,
        [organizationId, status],
      );
      return rows[0] ?? null;
    },

    async setVerified(organizationId: string, verified: boolean) {
      const { rows } = await pool.query(
        `UPDATE organizations o
            SET verified_at = CASE WHEN $2::boolean THEN COALESCE(o.verified_at, NOW()) ELSE NULL END, updated_at = NOW()
          WHERE o.id = $1 RETURNING ${ORG_COLUMNS}`,
        [organizationId, verified],
      );
      return rows[0] ?? null;
    },

    async listMembers(organizationId: string) {
      const { rows } = await pool.query(
        `SELECT m.user_id AS "userId", u.username, u.email, (${ACTIVE_USER}) AS "active", m.role,
                m.added_by AS "addedBy", m.created_at AS "createdAt"
           FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1
          ORDER BY m.created_at, m.user_id`,
        [organizationId],
      );
      return rows;
    },

    async listPending(organizationId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    email,
    role,
    added_by AS "addedBy",
    created_at AS "createdAt"
  FROM
    organization_pending_members
  WHERE
    organization_id = $1
  ORDER BY
    created_at,
    email
`,
        [organizationId],
      );
      return rows;
    },

    /**
     * Adds a member by email. A confirmed, live account becomes a member at once. Any other address
     * (no account, or an unconfirmed one) is stored as pending and claimed by GET /manage/me.
     */
    async addByEmail(organizationId: string, rawEmail: string, role: OrgRole, addedBy: string | null) {
      const email = rawEmail.trim().toLowerCase();
      return withTransaction(pool, async (client) => {
        await requireOrg(client, organizationId);
        const { rows: found } = await client.query(
          `SELECT u.id FROM users u WHERE lower(u.email) = $1 AND ${ACTIVE_USER}`,
          [email],
        );
        const userId: string | undefined = found[0]?.id;
        if (!userId) {
          await client.query(
            `INSERT INTO organization_pending_members (organization_id, email, role, added_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (organization_id, email) DO UPDATE SET role = EXCLUDED.role, added_by = EXCLUDED.added_by`,
            [organizationId, email, role, addedBy],
          );
          return { kind: 'pending' as const, email, role };
        }
        const { rowCount } = await client.query(
          `INSERT INTO organization_members (organization_id, user_id, role, added_by)
           VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [organizationId, userId, role, addedBy],
        );
        if (!rowCount) throw new OrganizationError(409, 'That person is already a member.', 'ALREADY_EXISTS');
        await client.query('DELETE FROM organization_pending_members WHERE organization_id = $1 AND email = $2', [
          organizationId,
          email,
        ]);
        return { kind: 'member' as const, userId, role };
      });
    },

    /** Removes a member. Refuses to remove the last active owner. */
    async removeMember(organizationId: string, userId: string) {
      return withTransaction(pool, async (client) => {
        await requireOrg(client, organizationId);
        const { target, otherActiveOwners } = await lockOwners(client, organizationId, userId);
        if (!target) throw new OrganizationError(404, 'That person is not a member.', 'NOT_FOUND');
        if (target === 'owner' && otherActiveOwners === 0) {
          throw new OrganizationError(409, 'An organization needs at least one owner.', 'INVALID_INPUT');
        }
        await client.query('DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2', [
          organizationId,
          userId,
        ]);
        return { userId, role: target };
      });
    },

    /** Changes a role. Refuses to demote the last active owner. */
    async changeRole(organizationId: string, userId: string, role: OrgRole) {
      return withTransaction(pool, async (client) => {
        await requireOrg(client, organizationId);
        const { target, otherActiveOwners } = await lockOwners(client, organizationId, userId);
        if (!target) throw new OrganizationError(404, 'That person is not a member.', 'NOT_FOUND');
        if (target === 'owner' && role !== 'owner' && otherActiveOwners === 0) {
          throw new OrganizationError(409, 'An organization needs at least one owner.', 'INVALID_INPUT');
        }
        await client.query('UPDATE organization_members SET role = $3 WHERE organization_id = $1 AND user_id = $2', [
          organizationId,
          userId,
          role,
        ]);
        return { userId, from: target, role };
      });
    },

    async removePending(organizationId: string, rawEmail: string) {
      const { rowCount } = await pool.query(
        'DELETE FROM organization_pending_members WHERE organization_id = $1 AND email = $2',
        [organizationId, rawEmail.trim().toLowerCase()],
      );
      return (rowCount ?? 0) > 0;
    },

    /**
     * Turns every pending row that matches the user's confirmed email into a membership, then deletes
     * the pending rows. An unconfirmed or deleted account claims nothing. An existing membership keeps its role.
     * Returns the memberships this call created.
     */
    async claimPending(userId: string): Promise<Array<{ organizationId: string; role: OrgRole; addedBy: string | null }>> {
      return withTransaction(pool, async (client) => {
        const { rows: users } = await client.query(
          `SELECT lower(u.email) AS email FROM users u WHERE u.id = $1 AND ${ACTIVE_USER} AND u.email IS NOT NULL`,
          [userId],
        );
        const email: string | undefined = users[0]?.email;
        if (!email) return [];
        // The delete takes the row locks, so a second concurrent claim waits and then finds nothing.
        const { rows: pending } = await client.query(
          `
  DELETE FROM organization_pending_members
  WHERE
    email = $1
  RETURNING
    organization_id AS "organizationId",
    role,
    added_by AS "addedBy"
`,
          [email],
        );
        const claimed = [];
        for (const row of pending) {
          const { rowCount } = await client.query(
            `INSERT INTO organization_members (organization_id, user_id, role, added_by)
             VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, user_id) DO NOTHING`,
            [row.organizationId, userId, row.role, row.addedBy],
          );
          if (rowCount) claimed.push(row);
        }
        return claimed;
      });
    },

    /** The user's role in one organization, or null. Applies the deleted-user and confirmed-email rules. */
    async membership(userId: string, organizationId: string) {
      const { rows } = await pool.query(
        `SELECT m.role, o.status, o.name, o.verified_at IS NOT NULL AS verified
           FROM organization_members m
           JOIN users u ON u.id = m.user_id
           JOIN organizations o ON o.id = m.organization_id
          WHERE m.organization_id = $1 AND m.user_id = $2 AND ${ACTIVE_USER}`,
        [organizationId, userId],
      );
      return (rows[0] as { role: OrgRole; status: OrgStatus; name: string; verified: boolean } | undefined) ?? null;
    },

    /** The organizations a user belongs to, for /auth/me and /manage/me. */
    async listForUser(userId: string) {
      const { rows } = await pool.query(
        `SELECT o.id, o.name, o.kind, o.status, o.verified_at IS NOT NULL AS verified, m.role
           FROM organization_members m
           JOIN users u ON u.id = m.user_id
           JOIN organizations o ON o.id = m.organization_id
          WHERE m.user_id = $1 AND ${ACTIVE_USER}
          ORDER BY o.name, o.id`,
        [userId],
      );
      return rows as Array<{ id: string; name: string; kind: string; status: OrgStatus; verified: boolean; role: OrgRole }>;
    },

    /** Same-organization check for masking: is this user a current member? */
    async isMember(organizationId: string, userId: string) {
      const { rows } = await pool.query(
        'SELECT 1 FROM organization_members WHERE organization_id = $1 AND user_id = $2',
        [organizationId, userId],
      );
      return rows.length > 0;
    },

    /**
     * How organizer-visible lists name the person behind an edit (owner decision 9): "Alex at Venue X" for a
     * teammate, from the display name and never the attendee username, and "Festie support" for anyone else.
     */
    async editorLabel(organizationId: string, userId: string | null) {
      if (!userId) return null;
      const { rows } = await pool.query(
        `
  SELECT
    u.display_name AS "displayName",
    o.name AS "organizationName"
  FROM
    organization_members m
    JOIN users u ON u.id = m.user_id
    JOIN organizations o ON o.id = m.organization_id
  WHERE
    m.organization_id = $1
    AND m.user_id = $2
`,
        [organizationId, userId],
      );
      if (!rows[0]) return SUPPORT_LABEL;
      return `${String(rows[0].displayName ?? '').trim() || 'A teammate'} at ${rows[0].organizationName}`;
    },

    /** Confirmed email addresses of the organization's active owners, for decision emails. */
    async ownerEmails(organizationId: string): Promise<string[]> {
      const { rows } = await pool.query(
        `SELECT u.email FROM organization_members m JOIN users u ON u.id = m.user_id
          WHERE m.organization_id = $1 AND m.role = 'owner' AND ${ACTIVE_USER} AND u.email IS NOT NULL
          ORDER BY m.created_at, m.user_id`,
        [organizationId],
      );
      return rows.map((row: { email: string }) => row.email);
    },

    /** What festivalAccess needs about a festival: its owner organization and whether it is live. */
    async festivalAccessRow(festivalId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    id,
    organization_id AS "organizationId",
    published_at AS "publishedAt",
    deleted_at AS "deletedAt"
  FROM
    festivals
  WHERE
    id = $1
`,
        [festivalId],
      );
      return (
        (rows[0] as { id: string; organizationId: string | null; publishedAt: Date | null; deletedAt: Date | null } | undefined) ??
        null
      );
    },

    /** The festivals of the given organizations, drafts and soft-deleted ones included. Never read from a shared cache. */
    async listFestivals(organizationIds: string[]) {
      if (organizationIds.length === 0) return [];
      const { rows } = await pool.query(
        `
  SELECT
    id,
    name,
    COALESCE(location, '') AS location,
    organization_id AS "organizationId",
    slug,
    (published_at IS NOT NULL) AS published,
    (deleted_at IS NOT NULL) AS deleted,
    publish_requested_at AS "publishRequestedAt",
    publish_review_note AS "publishReviewNote",
    updated_at AS "updatedAt"
  FROM
    festivals
  WHERE
    organization_id = ANY ($1::text[])
  ORDER BY
    updated_at DESC,
    id
  LIMIT
    500
`,
        [organizationIds],
      );
      return rows;
    },

    /** Live (not soft-deleted) festivals of an organization, and how many of those are drafts. */
    async festivalCounts(organizationId: string) {
      const { rows } = await pool.query(
        `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (
      WHERE
        published_at IS NULL
    )::int AS drafts
  FROM
    festivals
  WHERE
    organization_id = $1
    AND deleted_at IS NULL
`,
        [organizationId],
      );
      return { total: rows[0].total as number, drafts: rows[0].drafts as number };
    },
  };
}
