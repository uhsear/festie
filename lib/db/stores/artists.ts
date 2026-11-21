// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The artists table: match, create, edit, usage lists, and syncArtistCopies, which rewrites the copy
 * of an artist that every set and announced-lineup entry holds. An edit changes past festivals too.
 *
 * Lock order for every writer: festivals in id order, then artists in id order. An
 * artist edit does not know which festivals it needs until it reads them, so it reads the ids, locks
 * those festivals, locks the artist, then reads the ids again. A new id means a save added the artist
 * to a festival in between: the transaction rolls back with a retryable error and starts again.
 */

import type { Pool, PoolClient } from 'pg';
import { withTransactionRetry } from '../connection';
import { createOpaqueId } from '../../helpers';
import { artistNameKey } from '../../artist-key';
import { duplicatePartners } from '../../artist-duplicates';
import { detectPlatform, normalizeArtistLink } from '../../artist-links';
import { todayInZone } from '../../lineup';
import { AUDIT_ACTIONS } from '../../audit-actions';
import {
  MAX_ARTIST_LABEL,
  MAX_CANDIDATES,
  type Links,
  type ArtistRecord,
  ARTIST_COLUMNS,
  ArtistError,
  retryTransaction,
  type ArtistActor,
  insertArtistAudit,
  publicArtist,
  cleanLabel,
  cleanArtistName,
  artistTitle,
  auditFields,
  liveArtistsByKey,
  liveArtistsBySpotifyId,
  type ArtistUse,
  artistUses,
  lockFestivalsUsing,
  type SyncedFestival,
  rewriteCopies,
  isCurrentOrUpcoming,
  type ArtistChanges,
  applyChanges,
  tokenIsFresh,
  assertFreshToken,
  assertNoClash,
  artistConflict,
  type MergePick,
  mergedFields,
  findMergeRefs,
  moveRefs,
  type MatchItem,
  type MatchOutcome,
  viewerArtist,
  nextAutoLabel,
} from './artists-helpers';
import { adminSuggestion, insertSuggestion, organizerVerdict, ownSuggestion } from './artist-suggestions';
import { type ArtistViewer, viewerMask, visibleCondition, useIsVisible, useIsForeign } from './artist-visibility';

/** An image on one of Spotify's image hosts, the same hosts the web attribution check accepts. */
const SPOTIFY_IMAGE_URL = /^https:\/\/(?:[a-z0-9-]+\.)*(?:scdn\.co|spotifycdn\.com)\//i;

export {
  rewriteCopies,
  ArtistError,
  publicArtist,
  artistTitle,
  liveArtistsByKey,
  liveArtistsBySpotifyId,
  resolveArtistIds,
  lockArtistRows,
  isCurrentOrUpcoming,
  type ArtistRecord,
  type ArtistActor,
  type ArtistUse,
  type SyncedFestival,
  type ArtistChanges,
  type MergePick,
  type MatchItem,
  viewerArtist,
} from './artists-helpers';
export type { ArtistViewer } from './artist-visibility';

export interface UpdateInput {
  expectedUpdatedAt?: string;
  changes: ArtistChanges;
  userId: string | null;
  ip?: string | null;
  viewer?: ArtistViewer;
  festivalId?: string | null;
  /** More audit details, for the edit an accepted suggestion makes. */
  via?: Record<string, unknown>;
}

export type UpdateOutcome =
  | { status: 'updated'; artist: ArtistRecord; synced: SyncedFestival[]; before: ArtistRecord; fill: boolean }
  | { status: 'suggested'; suggestionId: string };

/** An artist entry on a set or lineup row, as a festival payload carries it. */
type NamedArtist = { id?: string | null; name?: string } | null | undefined;

export function createArtistsStore(pool: Pool) {
  // A caller that already holds a transaction (the artist review approval) passes its client; the work then joins it.
  const inTransaction = <T>(existing: PoolClient | undefined, fn: (client: PoolClient) => Promise<T>) =>
    existing ? fn(existing) : withTransactionRetry(pool, fn);

  const candidatesOf = (rows: ArtistRecord[], uses: Map<string, ArtistUse[]>, viewer?: ArtistViewer) => {
    return rows.slice(0, MAX_CANDIDATES).map((row) => {
      // A viewer is never told the name of a festival it may not see.
      const live = (uses.get(row.id) ?? []).filter((u) => !u.deleted && (!viewer || useIsVisible(u, viewer)));
      return {
        id: row.id,
        name: row.name,
        label: viewer && row.label_auto ? '' : row.label,
        photo: row.photo,
        platforms: Object.keys(row.links ?? {}),
        lastFestival: live[0] ? { id: live[0].festivalId, name: live[0].name } : null,
      };
    });
  };

  /**
   * One artist edit inside the caller's transaction: lock the festivals that list the artist, lock the artist,
   * check the token, then save it or (for an organizer, see organizerVerdict) store a suggestion instead.
   * `expectedUpdatedAt` is left out only when an admin applies a stored suggestion to the current row.
   */
  async function updateWithin(client: PoolClient, id: string, input: UpdateInput): Promise<UpdateOutcome> {
    const { festivalIds, assertUnchanged } = await lockFestivalsUsing(client, [id]);
    const { rows } = await client.query(`SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 FOR UPDATE`, [id]);
    const before = rows[0] as ArtistRecord | undefined;
    if (!before) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
    if (before.merged_into) {
      // A viewer learns nothing about a hidden artist, so its visibility is checked before the merge is mentioned,
      // and the survivor is named only when the viewer can see it too.
      const seen = input.viewer ? await viewerMask(client, input.viewer, [before.id, before.merged_into]) : null;
      if (seen && !seen.has(before.id)) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
      const survivor =
        seen && !seen.has(before.merged_into)
          ? undefined
          : (await client.query('SELECT name, label FROM artists WHERE id = $1', [before.merged_into])).rows[0];
      throw new ArtistError(
        409,
        'ARTIST_CHANGED',
        `This artist was already merged into ${survivor ? artistTitle(survivor) : 'another artist'}.`,
      );
    }
    // A viewer that cannot see the artist gets the 404 before any other answer, so a token check never confirms it exists.
    const verdict = input.viewer ? await organizerVerdict(client, before, input.viewer, input.changes) : 'direct';
    if (input.expectedUpdatedAt !== undefined) await assertFreshToken(client, before, input.expectedUpdatedAt);
    if (verdict === 'suggest' && input.viewer) {
      applyChanges(before, input.changes); // a change that cannot apply is refused now, not when an admin reads it
      const suggestionId = await insertSuggestion(client, before, input.viewer, input.changes, input.festivalId ?? null, input.ip);
      return { status: 'suggested', suggestionId };
    }
    const applied = applyChanges(before, input.changes);
    let label = applied.label;
    let autoPicked = false;
    if (input.viewer) {
      // A new name or note that a hidden artist holds gets a neutral automatic note, so nothing shows it exists.
      const { rows: others } = await client.query(
        `SELECT ${ARTIST_COLUMNS} FROM artists WHERE name_key = $1 AND merged_into IS NULL AND id <> $2`,
        [applied.key, id],
      );
      const holder = (others as ArtistRecord[]).find((row) => row.label.toLowerCase() === label.toLowerCase());
      if (holder && !(await viewerMask(client, input.viewer, [holder.id])).has(holder.id)) {
        label = nextAutoLabel((others as ArtistRecord[]).map((row) => row.label));
        autoPicked = true;
      }
    }
    const next = { ...applied, label };
    await assertNoClash(client, id, next);
    const labelAuto = autoPicked || (input.changes.label === undefined && before.label_auto);
    // A Spotify photo and the genres belong to the Spotify artist, so they leave with its link. Another photo stays.
    const spotifyReplaced = !!before.spotify_id && before.spotify_id !== next.spotifyId;
    const { rows: updated } = await client.query(
      `UPDATE artists SET name = $2, name_key = $3, label = $4, spotify_id = $5, links = $6::jsonb,
              photo = CASE WHEN $8 AND photo LIKE 'https://i.scdn.co/%' THEN NULL ELSE photo END,
              genres = CASE WHEN $8 THEN '[]'::jsonb ELSE genres END,
              label_auto = $9, updated_by = $7, updated_at = now()
        WHERE id = $1 RETURNING ${ARTIST_COLUMNS}`,
      [id, next.name, next.key, next.label, next.spotifyId, JSON.stringify(next.links), input.userId, spotifyReplaced, labelAuto],
    );
    const artist = updated[0] as ArtistRecord;
    // A save may have put the artist on a festival after the first read, before it could lock the artist.
    await assertUnchanged();
    const copyChanged =
      before.name !== artist.name ||
      before.photo !== artist.photo ||
      JSON.stringify(before.links ?? {}) !== JSON.stringify(artist.links ?? {});
    const synced = copyChanged ? await rewriteCopies(client, festivalIds, artist) : [];
    const fill = verdict === 'fill';
    await insertArtistAudit(
      client,
      id,
      {
        userId: input.userId,
        ip: input.ip,
        ...(input.viewer ? { actorType: 'organizer' as const, organizationId: input.viewer.organizationId } : {}),
      },
      {
        name: artist.name,
        ...(before.name !== artist.name ? { renamedFrom: before.name } : {}),
        fields: Object.keys(input.changes).filter((key) => (input.changes as Record<string, unknown>)[key] !== undefined),
        festivalsUpdated: synced.length,
        // Enough to see what changed and where: the festival ids are capped so one row stays small.
        before: { name: before.name, label: before.label, links: before.links ?? {} },
        after: { name: artist.name, label: artist.label, links: artist.links ?? {} },
        festivalIds: synced.slice(0, 200).map((festival) => festival.id),
        ...(fill ? { via: 'organizer-fill', flagged: true } : {}),
        ...input.via,
      },
    );
    return { status: 'updated', artist, synced, before, fill };
  }

  return {
    /** One edit inside the caller's transaction (the artist review approval). The caller owns the commit and the retries. */
    updateWithin,

    /**
     * For each name, the live artists it could be. A Spotify artist link whose id belongs to a live
     * artist, or exactly one live artist with the same key, is "linked". Two or more is "pick".
     * With a `viewer` (an organizer) only visible artists count, so a hidden artist never changes an answer, and an
     * artist the viewer may not link by name or Spotify id is "pick" even when it is the only one.
     */
    async match(items: MatchItem[], viewer?: ArtistViewer) {
      const prepared = items.map((item) => {
        const name = cleanArtistName(item.name);
        const result = item.spotify ? normalizeArtistLink('spotify', item.spotify) : null;
        return {
          name,
          key: name ? artistNameKey(name) : '',
          spotifyId: result?.ok ? (result.spotifyId ?? null) : null,
        };
      });
      const [byKey, bySpotify] = await Promise.all([
        liveArtistsByKey(pool, [...new Set(prepared.map((p) => p.key).filter(Boolean))]),
        liveArtistsBySpotifyId(pool, [...new Set(prepared.map((p) => p.spotifyId).filter((id): id is string => !!id))]),
      ]);
      const mask = viewer
        ? await viewerMask(pool, viewer, [...new Set([...byKey.values(), ...bySpotify.values()].flat().map((row) => row.id))])
        : null;
      const rowsOf = (p: (typeof prepared)[number]) => {
        const spotifyHit = p.spotifyId ? bySpotify.get(p.spotifyId) : undefined;
        if (spotifyHit && (!mask || mask.get(spotifyHit.id)?.linkable)) return [spotifyHit];
        const rows = byKey.get(p.key) ?? [];
        return mask ? rows.filter((row) => mask.has(row.id)) : rows;
      };
      // One scan of the sets and lineups for the whole paste, not one per name.
      const candidateIds = new Set(
        prepared.flatMap((p) =>
          rowsOf(p)
            .slice(0, MAX_CANDIDATES)
            .map((row) => row.id),
        ),
      );
      const uses = await artistUses(pool, [...candidateIds]);
      return prepared.map((p) => {
        const rows = rowsOf(p);
        const linkable = rows.length === 1 && (!mask || mask.get(rows[0]!.id)?.linkable === true);
        const outcome: MatchOutcome = linkable ? 'linked' : rows.length > 0 ? 'pick' : 'new';
        return { name: p.name, outcome, candidates: candidatesOf(rows, uses, viewer) };
      });
    },

    async getById(id: string, db: { query: Pool['query'] } = pool): Promise<ArtistRecord | null> {
      const { rows } = await db.query(`SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1`, [id]);
      return (rows[0] as ArtistRecord | undefined) ?? null;
    },

    /**
     * A new artist. When a live artist has the same key, the editor must add a note to tell them apart.
     * A clash on key and note, or on the Spotify id, is a 409 that names the other artist.
     * With a `viewer` (an organizer) the artist starts unverified, takes no Spotify link (that goes to review),
     * and a clash with an artist the viewer cannot see gets a neutral automatic note instead of an error, so
     * the answer is the same whether or not a hidden artist exists.
     */
    async create(input: { name: string; label?: string; link?: string; userId: string | null }, viewer?: ArtistViewer) {
      const name = cleanArtistName(input.name);
      if (!name) throw new ArtistError(400, 'INVALID_INPUT', 'The name cannot be empty.');
      const label = cleanLabel(input.label ?? '');
      if (label === null)
        throw new ArtistError(400, 'INVALID_INPUT', `The note can be at most ${MAX_ARTIST_LABEL} characters.`);
      const links: Links = {};
      let spotifyId: string | null = null;
      if (input.link) {
        const platform = detectPlatform(input.link) ?? 'website';
        if (viewer && platform === 'spotify') {
          throw new ArtistError(400, 'INVALID_INPUT', 'Festie checks Spotify links first. Create the artist, then suggest the link.');
        }
        const result = normalizeArtistLink(platform, input.link);
        if (!result.ok) throw new ArtistError(400, 'INVALID_INPUT', result.message);
        links[platform] = result.url;
        spotifyId = result.spotifyId ?? null;
      }
      const key = artistNameKey(name);
      const id = createOpaqueId('art');
      try {
        return await withTransactionRetry(pool, async (client) => {
          const { rows: same } = await client.query(
            `SELECT ${ARTIST_COLUMNS} FROM artists WHERE name_key = $1 AND merged_into IS NULL`,
            [key],
          );
          const mask = viewer ? await viewerMask(client, viewer, same.map((row: { id: string }) => row.id)) : null;
          const seen = mask ? same.filter((row: { id: string }) => mask.has(row.id)) : same;
          if (seen.length > 0 && !label) {
            throw new ArtistError(
              400,
              'INVALID_INPUT',
              `There is already an artist named ${seen[0].name}. Add a note to tell them apart, for example UK or Berlin.`,
              { existingIds: seen.map((row: { id: string }) => row.id) },
            );
          }
          // A hidden artist that holds this name and note: take the next neutral note, so nothing shows it exists.
          let finalLabel = label;
          let labelAuto = false;
          const holder = mask ? same.find((row: ArtistRecord) => row.label.toLowerCase() === label.toLowerCase()) : undefined;
          if (holder && !mask!.has(holder.id)) {
            finalLabel = nextAutoLabel(same.map((row: ArtistRecord) => row.label));
            labelAuto = true;
          }
          await assertNoClash(client, id, { key, label: finalLabel, spotifyId });
          try {
            const { rows } = await client.query(
              `INSERT INTO artists (id, name, name_key, label, spotify_id, links, created_by, updated_by, verified, label_auto)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7, $8, $9) RETURNING ${ARTIST_COLUMNS}`,
              [id, name, key, finalLabel, spotifyId, JSON.stringify(links), input.userId, !viewer, labelAuto],
            );
            return rows[0] as ArtistRecord;
          } catch (error) {
            // A concurrent create took the note. Start over, so the next read sees the holder and answers as usual.
            if (viewer && (error as { code?: string })?.code === '23505') throw retryTransaction('the note was taken');
            throw error;
          }
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * Edits one artist and rewrites its copy in every festival, past and archived ones included.
     * `expectedUpdatedAt` is the artist's updatedAt the editor loaded. Returns the artist and the
     * festivals whose copy was rewritten, so the route can refresh caches and notify clients.
     */
    async update(
      id: string,
      input: { expectedUpdatedAt: string; changes: ArtistChanges; userId: string | null; ip?: string | null },
    ): Promise<{ artist: ArtistRecord; synced: SyncedFestival[]; before: ArtistRecord }> {
      try {
        const outcome = await withTransactionRetry(pool, (client) => updateWithin(client, id, input));
        if (outcome.status !== 'updated') throw new Error('an admin edit never becomes a suggestion');
        return outcome;
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * An organizer's edit (artist plan 8.3). Under the same locks as `update` it decides whether the change
     * saves at once (`updated`, with `fill` set for the flagged carve-out that fills an empty non-Spotify link of
     * a shared artist) or becomes a pending suggestion for an admin (`suggested`). `festivalId` records where the
     * organizer was working. An artist the viewer cannot see is a 404.
     */
    async organizerUpdate(
      id: string,
      input: {
        expectedUpdatedAt: string;
        changes: ArtistChanges;
        festivalId?: string | null;
        ip?: string | null;
      },
      viewer: ArtistViewer,
    ): Promise<UpdateOutcome> {
      try {
        return await withTransactionRetry(pool, (client) =>
          updateWithin(client, id, { ...input, userId: viewer.userId, viewer }),
        );
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /** Pending suggestions are listed oldest first; decided ones newest first. */
    async listSuggestions(opts: { status: 'pending' | 'accepted' | 'rejected' | 'all'; limit: number }) {
      const { rows } = await pool.query(
        `
  SELECT
    s.id,
    s.artist_id,
    s.festival_id,
    s.organization_id,
    s.changes,
    s.status,
    s.note,
    s.created_at,
    s.decided_at,
    a.name AS artist_name,
    a.label AS artist_label,
    a.links AS artist_links,
    a.merged_into,
    o.name AS organization_name,
    u.username AS created_by_name,
    f.name AS festival_name
  FROM
    artist_suggestions s
    JOIN artists a ON a.id = s.artist_id
    LEFT JOIN organizations o ON o.id = s.organization_id
    LEFT JOIN users u ON u.id = s.created_by
    LEFT JOIN festivals f ON f.id = s.festival_id
  WHERE
    $1 = 'all'
    OR s.status = $1
  ORDER BY
    CASE
      WHEN s.status = 'pending' THEN 0
      ELSE 1
    END,
    CASE
      WHEN s.status = 'pending' THEN s.created_at
    END ASC,
    s.created_at DESC
  LIMIT
    $2
`,
        [opts.status, opts.limit],
      );
      const uses = await artistUses(pool, [...new Set(rows.map((row: { artist_id: string }) => row.artist_id))] as string[]);
      return rows.map((row: any) => adminSuggestion(row, (uses.get(row.artist_id) ?? []).length));
    },

    /** The suggestions of the viewer's organizations, newest first, so a row can show "Pending review" and the decision. */
    async ownSuggestions(viewer: ArtistViewer) {
      const { rows } = await pool.query(
        `
  SELECT
    s.id,
    s.artist_id,
    s.changes,
    s.status,
    s.note,
    s.created_at,
    s.decided_at,
    a.name AS artist_name
  FROM
    artist_suggestions s
    JOIN artists a ON a.id = s.artist_id
  WHERE
    s.organization_id = ANY ($1::text[])
  ORDER BY
    s.created_at DESC
  LIMIT
    100
`,
        [viewer.organizationIds],
      );
      return rows.map(ownSuggestion);
    },

    /**
     * An admin decides a pending suggestion. Accepting applies the stored change to the artist's current row in the
     * same transaction, under the usual festival then artist locks, and rewrites every festival copy. The change
     * can still fail on a clash that appeared since (a 409 that names the other artist). Rejecting only closes it.
     */
    async decideSuggestion(
      suggestionId: string,
      input: { decision: 'accept' | 'reject'; note?: string | null; userId: string | null; ip?: string | null },
    ): Promise<{ status: 'accepted' | 'rejected'; artistId: string; synced: SyncedFestival[] }> {
      const { rows: found } = await pool.query('SELECT artist_id FROM artist_suggestions WHERE id = $1', [suggestionId]);
      if (!found[0]) throw new ArtistError(404, 'NOT_FOUND', 'Suggestion not found.');
      const artistId = found[0].artist_id as string;
      const alreadyDecided = () => new ArtistError(409, 'ARTIST_CHANGED', 'Someone already decided this suggestion.');
      try {
        return await withTransactionRetry(pool, async (client) => {
          let synced: SyncedFestival[] = [];
          if (input.decision === 'accept') {
            const { rows } = await client.query(
              `SELECT changes FROM artist_suggestions WHERE id = $1 AND status = 'pending'`,
              [suggestionId],
            );
            if (!rows[0]) throw alreadyDecided();
            // The artist and its festivals lock first (the one lock order); the suggestion row locks when it is updated.
            const outcome = await updateWithin(client, artistId, {
              changes: rows[0].changes as ArtistChanges,
              userId: input.userId,
              ip: input.ip,
              via: { suggestionId },
            });
            if (outcome.status === 'updated') synced = outcome.synced;
          }
          const status = input.decision === 'accept' ? 'accepted' : 'rejected';
          const { rowCount } = await client.query(
            `
  UPDATE artist_suggestions
  SET
    status = $2,
    note = $3,
    decided_by = $4,
    decided_at = now()
  WHERE
    id = $1
    AND status = 'pending'
`,
            [suggestionId, status, input.note ? input.note.slice(0, 500) : null, input.userId],
          );
          if (!rowCount) throw alreadyDecided();
          await insertArtistAudit(
            client,
            artistId,
            { userId: input.userId, ip: input.ip },
            { suggestionId, decision: status, note: input.note ?? null },
            AUDIT_ACTIONS.ARTIST_SUGGESTION_DECIDED,
          );
          return { status, artistId, synced } as const;
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /** An admin marks an artist verified. The edit token and the festival copies are untouched. */
    async verify(id: string, input: { userId: string | null; ip?: string | null }) {
      return withTransactionRetry(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 AND merged_into IS NULL FOR UPDATE`,
          [id],
        );
        const row = rows[0] as ArtistRecord | undefined;
        if (!row) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
        if (row.verified) return row;
        const { rows: updated } = await client.query(
          `UPDATE artists SET verified = true, updated_by = $2 WHERE id = $1 RETURNING ${ARTIST_COLUMNS}`,
          [id, input.userId],
        );
        await insertArtistAudit(
          client,
          id,
          { userId: input.userId, ip: input.ip },
          { name: row.name, fields: ['verified'], before: { verified: false }, after: { verified: true } },
        );
        return updated[0] as ArtistRecord;
      });
    },

    /**
     * Fills an empty photo or genre list of an artist that already has a Spotify link, from Spotify's
     * data. Nothing the artist has is replaced. Every festival's copy follows, so an artist on other
     * festivals is allowed: filling an empty field is not a contested edit. `unchanged` when nothing was empty.
     */
    async refreshSpotifyDetails(
      id: string,
      input: { photo: string | null; genres: string[]; userId: string | null; ip?: string | null },
    ): Promise<{ status: 'saved'; artist: ArtistRecord; synced: SyncedFestival[] } | { status: 'unchanged' }> {
      try {
        return await withTransactionRetry(pool, async (client) => {
          const { festivalIds, assertUnchanged } = await lockFestivalsUsing(client, [id]);
          const { rows } = await client.query(
            `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 AND merged_into IS NULL FOR UPDATE`,
            [id],
          );
          const before = rows[0] as ArtistRecord | undefined;
          if (!before) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
          const filled = await this.fillEmpty(
            client,
            id,
            { photo: input.photo ?? undefined, genres: input.genres },
            { userId: input.userId, ip: input.ip, skipAudit: true },
          );
          if (!filled?.changed) return { status: 'unchanged' as const };
          const artist = filled.artist;
          await assertUnchanged();
          const synced = await rewriteCopies(client, festivalIds, artist);
          await insertArtistAudit(
            client,
            id,
            { userId: input.userId, ip: input.ip },
            {
              name: artist.name,
              fields: [
                ...(before.photo !== artist.photo ? ['photo'] : []),
                ...(JSON.stringify(before.genres ?? []) !== JSON.stringify(artist.genres ?? []) ? ['genres'] : []),
              ],
              via: 'spotify-refresh',
              festivalsUpdated: synced.length,
              before: { photo: before.photo ?? null, genres: before.genres ?? [] },
              after: { photo: artist.photo ?? null, genres: artist.genres ?? [] },
            },
          );
          return { status: 'saved' as const, artist, synced };
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * Replaces an artist's photo and genres with what Spotify says now, and stamps spotify_fetched_at,
     * so Spotify content is never kept past the refresh limit (Spotify Developer Terms IV.3.1.1). Unlike
     * refreshSpotifyDetails it overwrites: a Spotify photo that Spotify no longer returns is cleared, but a
     * photo that did not come from Spotify is kept. The row is stamped
     * even when nothing changed, or the artist would be read again on every run. Every festival's copy follows
     * a change. Only an artist with a Spotify id qualifies.
     */
    async renewSpotifyDetails(
      id: string,
      input: { photo: string | null; genres: string[]; userId: string | null; ip?: string | null },
    ): Promise<{ status: 'saved'; artist: ArtistRecord; synced: SyncedFestival[] } | { status: 'unchanged' }> {
      try {
        return await withTransactionRetry(pool, async (client) => {
          const { festivalIds, assertUnchanged } = await lockFestivalsUsing(client, [id]);
          const { rows } = await client.query(
            `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 AND merged_into IS NULL AND spotify_id IS NOT NULL FOR UPDATE`,
            [id],
          );
          const before = rows[0] as ArtistRecord | undefined;
          if (!before) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
          // A photo from a lineup import or a merge is not Spotify's to replace or clear, so it stays.
          const keepsPhoto = !!before.photo && !SPOTIFY_IMAGE_URL.test(before.photo);
          const photo = keepsPhoto ? before.photo : input.photo?.startsWith('https://') ? input.photo.slice(0, 500) : null;
          const genres = (input.genres ?? []).slice(0, 10);
          if (photo === (before.photo ?? null) && JSON.stringify(genres) === JSON.stringify(before.genres ?? [])) {
            await client.query('UPDATE artists SET spotify_fetched_at = now() WHERE id = $1', [id]);
            return { status: 'unchanged' as const };
          }
          const { rows: updated } = await client.query(
            `UPDATE artists SET photo = $2, genres = $3::jsonb, spotify_fetched_at = now(), updated_by = $4, updated_at = now()
              WHERE id = $1 RETURNING ${ARTIST_COLUMNS}`,
            [id, photo, JSON.stringify(genres), input.userId],
          );
          const artist = updated[0] as ArtistRecord;
          await assertUnchanged();
          const synced = await rewriteCopies(client, festivalIds, artist);
          await insertArtistAudit(
            client,
            id,
            { userId: input.userId, ip: input.ip },
            {
              name: artist.name,
              fields: [
                ...(before.photo !== artist.photo ? ['photo'] : []),
                ...(JSON.stringify(before.genres ?? []) !== JSON.stringify(artist.genres ?? []) ? ['genres'] : []),
              ],
              via: 'spotify-stale-refresh',
              festivalsUpdated: synced.length,
              before: { photo: before.photo ?? null, genres: before.genres ?? [] },
              after: { photo: artist.photo ?? null, genres: artist.genres ?? [] },
            },
          );
          return { status: 'saved' as const, artist, synced };
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * Live artists with a Spotify id whose Spotify data was never read or was read more than `maxAgeDays`
     * ago, oldest first (never read first). `excludeIds` lets a caller page through without meeting a row
     * that Spotify would not answer for again.
     */
    async listStaleSpotify(
      maxAgeDays: number,
      limit: number,
      excludeIds: string[] = [],
    ): Promise<Array<{ id: string; spotifyId: string }>> {
      const { rows } = await pool.query(
        `SELECT id, spotify_id AS "spotifyId" FROM artists
          WHERE spotify_id IS NOT NULL AND merged_into IS NULL
            AND (spotify_fetched_at IS NULL OR spotify_fetched_at < now() - make_interval(days => $1::int))
            AND NOT (id = ANY($3::text[]))
          ORDER BY spotify_fetched_at NULLS FIRST, id
          LIMIT $2`,
        [maxAgeDays, limit, excludeIds],
      );
      return rows;
    },

    /**
     * Stores a Spotify artist the editor picked: the link and spotify_id, and the photo and genres
     * only where the artist has none. The copies in every festival follow, past ones too, so an
     * artist on other festivals needs `acceptedAlsoOn`, the number of other festivals the editor
     * confirmed. How many there are is read again under the festival and artist locks: the list the
     * editor saw may be old. When there are more, the answer is `shared` and nothing is written. `spotify` comes from Spotify, never from the client.
     */
    async pickSpotify(
      id: string,
      input: {
        festivalId: string;
        expectedUpdatedAt: string;
        spotify: { spotifyId: string; photo: string | null; genres: string[] };
        acceptedAlsoOn: number;
        userId: string | null;
        ip?: string | null;
      },
    ): Promise<
      | { status: 'saved'; artist: ArtistRecord; before: ArtistRecord; synced: SyncedFestival[] }
      | { status: 'shared'; alsoOn: number }
    > {
      try {
        return await withTransactionRetry(pool, async (client) => {
          const { festivalIds, assertUnchanged } = await lockFestivalsUsing(client, [id]);
          const { rows } = await client.query(`SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 FOR UPDATE`, [id]);
          const before = rows[0] as ArtistRecord | undefined;
          if (!before) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
          if (before.merged_into)
            throw new ArtistError(409, 'ARTIST_CHANGED', 'This artist was already merged into another artist.');
          await assertFreshToken(client, before, input.expectedUpdatedAt);
          // A pick never replaces a link: an artist that has one is changed on its row, not here.
          if (before.links?.spotify) {
            throw new ArtistError(409, 'ARTIST_CHANGED', `${before.name} already has a Spotify link.`, {
              artist: publicArtist(before),
            });
          }
          const uses = (await artistUses(client, [id])).get(id) ?? [];
          const elsewhere = uses.filter((use) => use.festivalId !== input.festivalId).length;
          if (elsewhere > input.acceptedAlsoOn) return { status: 'shared' as const, alsoOn: elsewhere };
          const spotifyUrl = `https://open.spotify.com/artist/${input.spotify.spotifyId}`;
          await assertNoClash(client, id, {
            key: before.name_key,
            label: before.label,
            spotifyId: input.spotify.spotifyId,
          });
          const filled = await this.fillEmpty(
            client,
            id,
            { spotifyUrl, photo: input.spotify.photo ?? undefined, genres: input.spotify.genres },
            { userId: input.userId, ip: input.ip, skipAudit: true },
          );
          if (!filled || filled.skippedSpotify) throw retryTransaction('the Spotify link could not be stored');
          const artist = filled.artist;
          // A save may have put the artist on a festival after the first read, before it could lock the artist.
          await assertUnchanged();
          const synced = await rewriteCopies(client, festivalIds, artist);
          // A pick links Spotify and also fills an empty photo or genre list: audit what really changed.
          await insertArtistAudit(
            client,
            id,
            { userId: input.userId, ip: input.ip },
            {
              name: artist.name,
              fields: [
                ...(before.links?.spotify !== artist.links?.spotify ? ['spotify'] : []),
                ...(before.photo !== artist.photo ? ['photo'] : []),
                ...(JSON.stringify(before.genres ?? []) !== JSON.stringify(artist.genres ?? []) ? ['genres'] : []),
              ],
              via: 'spotify-pick',
              festivalsUpdated: synced.length,
              before: {
                name: before.name,
                label: before.label,
                links: before.links ?? {},
                photo: before.photo ?? null,
                genres: before.genres ?? [],
              },
              after: {
                name: artist.name,
                label: artist.label,
                links: artist.links ?? {},
                photo: artist.photo ?? null,
                genres: artist.genres ?? [],
              },
              festivalIds: synced.slice(0, 200).map((festival) => festival.id),
            },
          );
          return { status: 'saved' as const, artist, before, synced };
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * Merges `loserId` into `survivorId` (admin only). The loser becomes a tombstone that records the
     * refs it moved (merge_refs); every set and announced-lineup entry that listed it now lists the
     * survivor, and every festival copy is rewritten, archived festivals included. Lock order: festivals
     * in id order, then both artists in id order; a festival that began to list either artist between
     * the first read and the locks restarts the transaction. `acceptedFestivals` is the number of
     * festivals the editor saw in the preview: it is counted again under the locks, and a higher count
     * refuses the merge. The audit row is written in the same transaction.
     */
    async merge(input: {
      survivorId: string;
      loserId: string;
      survivorUpdatedAt: string;
      loserUpdatedAt: string;
      pick: MergePick;
      acceptedFestivals: number;
      userId: string | null;
      ip?: string | null;
      /** Join this open transaction instead of starting one. */
      client?: PoolClient;
      /** Extra audit details that tie the merge to what asked for it (the artist review item). */
      via?: Record<string, unknown>;
    }) {
      const { survivorId, loserId } = input;
      if (survivorId === loserId) throw new ArtistError(400, 'INVALID_INPUT', 'Pick two different artists to merge.');
      try {
        return await inTransaction(input.client, async (client) => {
          const loadPair = async (lock: boolean) => {
            const { rows } = await client.query(
              `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = ANY($1::text[]) ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
              [[survivorId, loserId]],
            );
            const byId = new Map<string, ArtistRecord>((rows as ArtistRecord[]).map((row) => [row.id, row]));
            const survivor = byId.get(survivorId);
            const loser = byId.get(loserId);
            if (!survivor || !loser) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
            for (const row of [survivor, loser]) {
              if (!row.merged_into) continue;
              const into = (await client.query('SELECT name, label FROM artists WHERE id = $1', [row.merged_into]))
                .rows[0];
              throw new ArtistError(
                409,
                'ARTIST_CHANGED',
                `This artist was already merged into ${into ? artistTitle(into) : 'another artist'}.`,
              );
            }
            return { survivor, loser };
          };
          const pair = [survivorId, loserId];
          await loadPair(false);
          const { festivalIds, assertUnchanged } = await lockFestivalsUsing(client, pair);
          const { survivor, loser } = await loadPair(true);
          await assertUnchanged();
          if (
            !(await tokenIsFresh(client, survivor, input.survivorUpdatedAt)) ||
            !(await tokenIsFresh(client, loser, input.loserUpdatedAt))
          ) {
            throw new ArtistError(409, 'ARTIST_CHANGED', 'Someone changed one of these artists. Reload the pair.', {
              survivor: publicArtist(survivor),
              loser: publicArtist(loser),
            });
          }
          if (festivalIds.length > input.acceptedFestivals) {
            throw new ArtistError(
              409,
              'ARTIST_CHANGED',
              `These artists now play on ${festivalIds.length} ${festivalIds.length === 1 ? 'festival' : 'festivals'}, more than the ${input.acceptedFestivals} you reviewed. Reload the pair and review the merge again.`,
              { festivals: festivalIds.length, accepted: input.acceptedFestivals },
            );
          }
          const found = await findMergeRefs(client, festivalIds, survivorId, loserId);
          const next = mergedFields(survivor, loser, input.pick);
          await assertNoClash(client, pair, next, { merging: true });
          const takesSpotify = next.spotifyId !== null && next.spotifyId === loser.spotify_id;
          const mergeRefs = {
            survivorId,
            mergedAt: new Date().toISOString(),
            mergedBy: input.userId,
            before: {
              name: loser.name,
              label: loser.label,
              spotifyId: loser.spotify_id,
              links: loser.links ?? {},
              photo: loser.photo,
              genres: loser.genres ?? [],
            },
            sets: found.refs.sets,
            lineup: found.refs.lineup,
          };
          // The tombstone goes first: it leaves the live name, note and Spotify indexes, so the survivor can take its values.
          await client.query(
            `
  UPDATE artists
  SET
    merged_into = $2,
    merge_refs = $3::jsonb,
    spotify_id = CASE
      WHEN $4::boolean THEN NULL
      ELSE spotify_id
    END,
    updated_by = $5,
    updated_at = now()
  WHERE
    id = $1
`,
            [loserId, survivorId, JSON.stringify(mergeRefs), takesSpotify, input.userId],
          );
          await client.query('UPDATE artists SET merged_into = $2 WHERE merged_into = $1', [loserId, survivorId]);
          // A pending suggestion on the tombstone can no longer apply: close it so the review list stays honest.
          await client.query(
            `
  UPDATE artist_suggestions
  SET
    status = 'rejected',
    note = 'The artist was merged into another artist.',
    decided_by = $2,
    decided_at = now()
  WHERE
    artist_id = $1
    AND status = 'pending'
`,
            [loserId, input.userId],
          );
          const { rows: updated } = await client.query(
            `UPDATE artists SET name = $2, name_key = $3, label = $4, spotify_id = $5, links = $6::jsonb, photo = $7, genres = $8::jsonb,
                    updated_by = $9, updated_at = now()
              WHERE id = $1 RETURNING ${ARTIST_COLUMNS}`,
            [
              survivorId,
              next.name,
              next.key,
              next.label,
              next.spotifyId,
              JSON.stringify(next.links),
              next.photo,
              JSON.stringify(next.genres),
              input.userId,
            ],
          );
          const artist = updated[0] as ArtistRecord;
          await moveRefs(client, found, survivorId, loserId);
          const synced = await rewriteCopies(client, festivalIds, artist);
          await insertArtistAudit(
            client,
            survivorId,
            { userId: input.userId, ip: input.ip },
            {
              survivorId,
              loserId,
              survivorName: artistTitle(survivor),
              loserName: artistTitle(loser),
              // A merge cannot be undone: keep what the pick overwrote on the survivor.
              survivorBefore: auditFields(survivor),
              survivorAfter: auditFields(artist),
              festivals: festivalIds.length,
              setsMoved: found.refs.sets.length,
              lineupEntriesMoved: found.refs.lineup.length,
              pick: input.pick,
              festivalIds: festivalIds.slice(0, 200),
              ...input.via,
            },
            AUDIT_ACTIONS.ARTIST_MERGED,
          );
          return {
            artist,
            loser,
            synced,
            counts: {
              festivals: festivalIds.length,
              sets: found.refs.sets.length,
              lineupEntries: found.refs.lineup.length,
            },
          };
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * Fills one raw link into an artist that has none for its platform, under the festival and artist
     * locks, and rewrites every copy. A link that is already there stays: a concurrent edit wins.
     * For an organizer (`viewer`) the artist must be visible, a Spotify link is never filled (it goes to review),
     * and the audit row names the organization and flags a fill of an artist that other tenants use.
     */
    async fillLink(
      id: string,
      input: { link: string; userId: string | null; ip?: string | null; viewer?: ArtistViewer },
    ): Promise<{ synced: SyncedFestival[] }> {
      try {
        return await withTransactionRetry(pool, async (client) => {
          const { festivalIds, assertUnchanged } = await lockFestivalsUsing(client, [id]);
          const { viewer } = input;
          let actor: ArtistActor = { userId: input.userId, ip: input.ip };
          if (viewer) {
            if (detectPlatform(input.link) === 'spotify') return { synced: [] };
            if (!(await viewerMask(client, viewer, [id])).has(id)) return { synced: [] };
            const uses = (await artistUses(client, [id])).get(id) ?? [];
            actor = { ...actor, actorType: 'organizer', organizationId: viewer.organizationId, flagged: uses.some((use) => useIsForeign(use, viewer)) };
          }
          const filled = await this.fillEmpty(client, id, { link: input.link }, actor);
          await assertUnchanged();
          if (!filled?.changed) return { synced: [] };
          return { synced: await rewriteCopies(client, festivalIds, filled.artist) };
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    /**
     * The festivals that list an artist, archived ones marked, newest first, with the counts an editor
     * weighs before a change: festivals by time (archived ones apart) and the copies a change rewrites.
     */
    async impact(id: string, now: Date = new Date(), viewer?: ArtistViewer) {
      let uses = (await artistUses(pool, [id])).get(id) ?? [];
      if (viewer) {
        // An organizer is told only about festivals it may see: its own and published ones. A stranger's draft is left out of the counts.
        if (!(await viewerMask(pool, viewer, [id])).has(id)) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
        uses = uses.filter((use) => useIsVisible(use, viewer));
      }
      const shownIds = uses.map((use) => use.festivalId);
      const counts = { past: 0, current: 0, upcoming: 0, archived: 0, sets: 0, lineupEntries: 0 };
      for (const u of uses) {
        if (u.deleted) counts.archived++;
        else if (!isCurrentOrUpcoming(u, now)) counts.past++;
        else if (!u.firstDate || u.firstDate > todayInZone(u.timeZone, now)) counts.upcoming++;
        else counts.current++;
      }
      const { rows } = await pool.query(
        `SELECT
           (SELECT count(*) FROM festival_sets WHERE jsonb_typeof(artists) = 'array' AND artists @> $1::jsonb
              AND ($3::text[] IS NULL OR festival_id = ANY($3::text[])))::int AS sets,
           (SELECT count(*) FROM festivals f,
              jsonb_array_elements(CASE WHEN jsonb_typeof(f.lineup) = 'array' THEN f.lineup ELSE '[]'::jsonb END) e
              WHERE f.lineup @> $2::jsonb AND jsonb_typeof(e->'artists') = 'array' AND e->'artists' @> $1::jsonb
              AND ($3::text[] IS NULL OR f.id = ANY($3::text[])))::int AS "lineupEntries"`,
        [JSON.stringify([{ id }]), JSON.stringify([{ artists: [{ id }] }]), viewer ? shownIds : null],
      );
      counts.sets = rows[0].sets;
      counts.lineupEntries = rows[0].lineupEntries;
      return {
        festivals: uses.map((u) => ({
          id: u.festivalId,
          name: u.name,
          published: u.published,
          archived: u.deleted,
          firstDate: u.firstDate,
        })),
        counts,
      };
    },

    /**
     * Artists on one festival (its sets and announced names), or every artist with `scope: 'all'`.
     * Rows with no links come first. `alsoOn` counts the other festivals, archived ones left out.
     * With `duplicates`, only artists that have a possible duplicate: pairs stay together and `duplicateOf` lists each partner's id.
     */
    async list(opts: { festivalId?: string; query?: string; limit: number; duplicates?: boolean }, viewer?: ArtistViewer) {
      let rows: ArtistRecord[];
      let partners = new Map<string, string[]>();
      if (opts.duplicates) {
        const { rows: keys } = await pool.query('SELECT id, name_key FROM artists WHERE merged_into IS NULL');
        partners = duplicatePartners(keys);
        ({ rows } = await pool.query(
          `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = ANY($1::text[]) ORDER BY name_key, lower(label), id`,
          [[...partners.keys()]],
        ));
        // A pair stays together: sort by the first name key in the pair. The sort is stable, so the SQL order holds inside a pair.
        const keyOf = new Map<string, string>(keys.map((k: { id: string; name_key: string }) => [k.id, k.name_key]));
        const first = (id: string) =>
          [id, ...(partners.get(id) ?? [])].map((other) => keyOf.get(other) ?? '').reduce((a, b) => (b < a ? b : a));
        rows.sort((a, b) => (first(a.id) < first(b.id) ? -1 : first(a.id) > first(b.id) ? 1 : 0));
        // The limit cuts after the sort, then pulls in the partners of the kept rows, so a duplicateOf id is always on the page.
        const page = new Set(rows.slice(0, opts.limit).flatMap((row) => [row.id, ...(partners.get(row.id) ?? [])]));
        rows = rows.filter((row) => page.has(row.id));
      } else if (opts.festivalId) {
        ({ rows } = await pool.query(
          `
  SELECT ${ARTIST_COLUMNS} FROM artists WHERE merged_into IS NULL AND id IN (
    SELECT u.artist_id FROM (
      SELECT a->>'id' AS artist_id FROM festival_sets s,
        jsonb_array_elements(CASE WHEN jsonb_typeof(s.artists) = 'array' THEN s.artists ELSE '[]'::jsonb END) a
        WHERE s.festival_id = $1
      UNION
      SELECT a->>'id' FROM festivals f,
        jsonb_array_elements(CASE WHEN jsonb_typeof(f.lineup) = 'array' THEN f.lineup ELSE '[]'::jsonb END) e,
        jsonb_array_elements(CASE WHEN jsonb_typeof(e->'artists') = 'array' THEN e->'artists' ELSE '[]'::jsonb END) a
        WHERE f.id = $1
    ) u WHERE u.artist_id IS NOT NULL)
  ORDER BY name_key, lower(label), id LIMIT $2`,
          [opts.festivalId, opts.limit],
        ));
      } else {
        const key = opts.query ? artistNameKey(opts.query) : '';
        const params: unknown[] = [key, `%${key.replace(/[\\%_]/g, '\\$&')}%`, opts.limit];
        const seen = viewer ? ` AND ${visibleCondition('artists', viewer, params)}` : '';
        ({ rows } = await pool.query(
          `SELECT ${ARTIST_COLUMNS} FROM artists WHERE merged_into IS NULL AND ($1 = '' OR name_key LIKE $2)${seen}
            ORDER BY name_key, lower(label), id LIMIT $3`,
          params,
        ));
      }
      const uses = await artistUses(
        pool,
        rows.map((r) => r.id),
      );
      const sameKey = new Map<string, number>();
      for (const row of rows) sameKey.set(row.name_key, (sameKey.get(row.name_key) ?? 0) + 1);
      const keysAcross = await liveArtistsByKey(pool, [...sameKey.keys()]);
      // For an organizer a same-name artist it cannot see does not count, and neither does a stranger's draft.
      const seenAcross = viewer
        ? await viewerMask(pool, viewer, [...keysAcross.values()].flat().map((row) => row.id))
        : null;
      const pending = viewer
        ? new Set<string>(
            (
              await pool.query(
                `
  SELECT DISTINCT
    artist_id
  FROM
    artist_suggestions
  WHERE
    status = 'pending'
    AND organization_id = ANY ($1::text[])
    AND artist_id = ANY ($2::text[])
`,
                [viewer.organizationIds, rows.map((r) => r.id)],
              )
            ).rows.map((r: { artist_id: string }) => r.artist_id),
          )
        : null;
      const items = rows.map((row) => {
        const others = (uses.get(row.id) ?? []).filter(
          (u) => u.festivalId !== opts.festivalId && !u.deleted && (!viewer || useIsVisible(u, viewer)),
        );
        const sameName = seenAcross
          ? (keysAcross.get(row.name_key) ?? []).filter((other) => seenAcross.has(other.id)).length > 1
          : (keysAcross.get(row.name_key)?.length ?? 1) > 1;
        return {
          ...(viewer ? viewerArtist(row) : publicArtist(row)),
          alsoOn: others.length,
          sameName,
          ...(pending ? { pendingReview: pending.has(row.id) } : {}),
          linkCount: Object.keys(row.links ?? {}).length,
          ...(opts.duplicates ? { duplicateOf: partners.get(row.id) ?? [] } : {}),
        };
      });
      // Possible duplicates keep their pairs together. Every other list puts rows with no links first: the editor's work list.
      return opts.duplicates ? items : items.sort((a, b) => Number(a.linkCount > 0) - Number(b.linkCount > 0));
    },

    /**
     * How many distinct names on a festival have no artist id and fit two or more live artists. The
     * save keeps such a name without an id, so the publish checklist asks the editor to pick one.
     */
    async countAmbiguousNames(
      festival: {
        days?: ({ sets?: ({ artists?: NamedArtist[] } | null)[] } | null)[];
        lineup?: ({ artists?: NamedArtist[] } | null)[];
      } | null | undefined,
      viewer?: ArtistViewer,
    ): Promise<number> {
      const elements = [
        ...(festival?.days ?? []).flatMap((day) => (day?.sets ?? []).flatMap((set) => set?.artists ?? [])),
        ...(festival?.lineup ?? []).flatMap((entry) => entry?.artists ?? []),
      ];
      const keys = [
        ...new Set(
          elements
            .filter((e) => !e?.id && typeof e?.name === 'string' && e.name.trim())
            .map((e) => artistNameKey((e as { name: string }).name)),
        ),
      ];
      const byKey = await liveArtistsByKey(pool, keys);
      if (!viewer) return keys.filter((key) => (byKey.get(key)?.length ?? 0) > 1).length;
      // The same rule as a save: hidden artists do not count, and one the viewer may not link by name must be picked.
      const mask = await viewerMask(pool, viewer, [...byKey.values()].flat().map((row) => row.id));
      return keys.filter((key) => {
        const seen = (byKey.get(key) ?? []).filter((row) => mask.has(row.id));
        return seen.length > 1 || (seen.length === 1 && !mask.get(seen[0]!.id)!.linkable);
      }).length;
    },

    /** Ids of the artists in `ids` that sit on a festival other than `festivalId`, archived ones included. */
    async sharedElsewhere(
      festivalId: string,
      ids: string[],
      db: { query: Pool['query'] } = pool,
    ): Promise<Set<string>> {
      const uses = await artistUses(db, ids);
      return new Set(ids.filter((id) => (uses.get(id) ?? []).some((u) => u.festivalId !== festivalId)));
    },

    /**
     * Fills empty fields of artists, inside the caller's transaction. Used by pickSpotify and by the old
     * "Find missing links" route (artists that sit on one festival only), so the caller rewrites the other copies (see rewriteCopies). A Spotify id that another
     * artist holds is left out and reported. Never overwrites a link.
     */
    async fillEmpty(
      client: PoolClient,
      id: string,
      fill: { spotifyUrl?: string; link?: string; photo?: string; genres?: string[] },
      actor: ArtistActor = { userId: null },
    ): Promise<{ artist: ArtistRecord; skippedSpotify: boolean; changed: boolean } | null> {
      const { rows } = await client.query(
        `SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = $1 AND merged_into IS NULL FOR UPDATE`,
        [id],
      );
      const row = rows[0] as ArtistRecord | undefined;
      if (!row) return null;
      const links: Links = { ...(row.links ?? {}) };
      let spotifyId = row.spotify_id;
      let skippedSpotify = false;
      // `link` is one raw link of any platform: it fills only a platform the artist has no link for.
      const linkPlatform = fill.link ? (detectPlatform(fill.link) ?? 'website') : null;
      const spotifyUrl = fill.spotifyUrl ?? (linkPlatform === 'spotify' ? fill.link : undefined);
      if (fill.link && linkPlatform && linkPlatform !== 'spotify' && !links[linkPlatform]) {
        const result = normalizeArtistLink(linkPlatform, fill.link);
        if (result.ok) links[linkPlatform] = result.url;
      }
      if (spotifyUrl && !links.spotify) {
        const result = normalizeArtistLink('spotify', spotifyUrl);
        if (result.ok) {
          const taken = await client.query(
            'SELECT 1 FROM artists WHERE spotify_id = $1 AND merged_into IS NULL AND id <> $2',
            [result.spotifyId, id],
          );
          if (taken.rowCount) skippedSpotify = true;
          else {
            links.spotify = result.url;
            spotifyId = result.spotifyId ?? null;
          }
        }
      }
      const photo = row.photo ?? (fill.photo?.startsWith('https://') ? fill.photo.slice(0, 500) : null);
      const genres = row.genres?.length ? row.genres : (fill.genres ?? []).slice(0, 10);
      // A call that fills nothing leaves updated_at alone: it is the edit token of the Artists screen.
      if (
        spotifyId === row.spotify_id &&
        photo === row.photo &&
        JSON.stringify(links) === JSON.stringify(row.links ?? {}) &&
        JSON.stringify(genres) === JSON.stringify(row.genres ?? [])
      ) {
        return { artist: row, skippedSpotify, changed: false };
      }
      const { rows: updated } = await client.query(
        `UPDATE artists SET links = $2::jsonb, spotify_id = $3, photo = $4, genres = $5::jsonb, updated_by = $6, updated_at = now()
          WHERE id = $1 RETURNING ${ARTIST_COLUMNS}`,
        [id, JSON.stringify(links), spotifyId, photo, JSON.stringify(genres), actor.userId],
      );
      if (!actor.skipAudit) {
        await insertArtistAudit(client, id, actor, {
          source: 'fill',
          ...(actor.flagged ? { flagged: true } : {}),
          name: row.name,
          before: { links: row.links ?? {}, photo: row.photo, genres: row.genres ?? [] },
          after: { links, photo, genres },
        });
      }
      return { artist: updated[0] as ArtistRecord, skippedSpotify, changed: true };
    },
  };
}
