// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The admin artist review queue: researched link, merge and rename proposals that an admin approves one by one.
 * An approval applies the change through the artist store's own edit and merge paths, inside the same transaction
 * that closes the item, so a refused edit leaves the item pending. Rejecting only closes it.
 */

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { isoOrNull, withTransactionRetry } from '../connection';
import { createOpaqueId } from '../../helpers';
import { artistNameKey } from '../../artist-key';
import { normalizeArtistLink } from '../../artist-links';
import {
  ARTIST_COLUMNS,
  ArtistError,
  artistConflict,
  artistTitle,
  artistUses,
  liveArtistsByKey,
  liveArtistsBySpotifyId,
  type ArtistRecord,
  type SyncedFestival,
} from './artists-helpers';
import type { createArtistsStore } from './artists';

type ReviewKind = 'link' | 'merge' | 'rename';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

interface ReviewCandidate {
  spotifyUrl: string;
  otherUrls: string[];
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
}

export interface ReviewItemInput {
  kind: ReviewKind;
  artistName: string;
  festival: string;
  artistIds: string[];
  candidates: ReviewCandidate[];
  proposed: { from: string; to: string };
  note: string;
}

type Db = { query: Pool['query'] };

const COLUMNS = `id, kind, artist_name, festival, artist_ids, candidates, proposed, note, status, chosen_url,
  decision_note, batch_generated_at, created_at, decided_at`;

/**
 * The same item, imported twice, hashes to the same key. Candidates and the note are left out: a re-run may refine
 * them, and the import then updates a pending item in place. A merge keeps its id order (loser, then survivor).
 */
function reviewItemKey(item: ReviewItemInput): string {
  const parts = [
    item.kind,
    item.artistName.trim().toLowerCase(),
    item.festival.trim(),
    item.kind === 'merge' ? item.artistIds : [...item.artistIds].sort(),
    item.proposed.from,
    item.proposed.to,
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** What a pending item would touch, so the admin sees it before approving. Absent when the item cannot resolve yet. */
interface ItemContext {
  /** A merge only: the artist merged away and the one that survives. */
  merge: { loserId: string; loserName: string; survivorId: string; survivorName: string } | null;
  /** A link or rename only: the artist as it is now. */
  current: { name: string; spotifyUrl: string | null } | null;
  festivalCount: number | null;
}

function publicItem(row: any, context: ItemContext | undefined) {
  return {
    id: row.id as string,
    kind: row.kind as ReviewKind,
    artistName: row.artist_name as string,
    festival: row.festival as string,
    artistIds: row.artist_ids as string[],
    candidates: row.candidates as ReviewItemInput['candidates'],
    proposed: row.proposed as { from: string; to: string },
    note: row.note as string,
    status: row.status as ReviewStatus,
    chosenUrl: (row.chosen_url as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
    createdAt: isoOrNull(row.created_at) as string,
    decidedAt: isoOrNull(row.decided_at),
    // A merge only: the festivals, archived ones too, that list either artist. The approval echoes it as acceptedFestivals.
    festivalCount: context?.festivalCount ?? null,
    // A pending merge only: who is merged into whom. The approval echoes the survivor as expectedSurvivorId.
    merge: context?.merge ?? null,
    // A pending link or rename only: the artist as it is now, so an approval that replaces a link is visible.
    current: context?.current ?? null,
  };
}

const invalid = (message: string) => new ArtistError(400, 'INVALID_INPUT', message);
const unresolved = (message: string) => new ArtistError(409, 'ARTIST_CHANGED', message);

/** The link an admin chose: a typed one wins, else the candidate at `candidateIndex`, else the first one. */
function chosenLink(row: any, input: { candidateIndex?: number; url?: string }): string {
  if (input.url) return input.url;
  const picked = (row.candidates as ReviewCandidate[])[input.candidateIndex ?? 0];
  if (input.candidateIndex !== undefined && !picked) throw invalid('That candidate does not exist.');
  return picked?.spotifyUrl ?? '';
}

/** The name a link or rename item says its artist has. */
const expectedName = (row: any): string => (row.kind === 'rename' ? row.proposed.from || row.artist_name : row.artist_name);

/** The live artist a link or rename applies to: the id the batch names, else the one live artist with that name. */
async function resolveArtist(db: Db, row: any, artists: ReturnType<typeof createArtistsStore>): Promise<string> {
  const named = (row.artist_ids as string[])[0];
  const name = expectedName(row);
  const key = artistNameKey(name);
  if (named) {
    const artist = await artists.getById(named, db);
    if (!artist) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
    // The batch was made for an artist with this name. If someone renamed it since, a stale approval would overwrite that edit.
    if (artist.name_key !== key) {
      throw unresolved(`This artist is now named ${artistTitle(artist)}, not ${name}. Reject this item, or fix the name on the Artists tab and approve again.`);
    }
    return named;
  }
  const live = (await liveArtistsByKey(db, [key])).get(key) ?? [];
  const only = live.length === 1 ? live[0] : undefined;
  if (only) return only.id;
  throw unresolved(
    live.length === 0
      ? `No artist is named ${name}. Fix the name on the Artists tab, then approve again.`
      : `${live.length} artists are named ${name}. Merge or rename them on the Artists tab, then approve again.`,
  );
}

const spotifyIdOf = (link: string): string | undefined => {
  const spotify = link ? normalizeArtistLink('spotify', link) : null;
  return spotify?.ok ? spotify.spotifyId : undefined;
};

/** The Spotify id that names a merge's survivor: only when the batch gives no second id. */
const survivorSpotifyId = (row: any, link: string) => ((row.artist_ids as string[])[1] ? undefined : spotifyIdOf(link));

/** A merge: the artist merged away is the first id; the survivor is the second id, else the holder of the chosen Spotify artist. */
function mergePair(row: any, holder: ArtistRecord | undefined) {
  const [loserId, secondId] = row.artist_ids as string[];
  if (!loserId) throw unresolved('This merge names no artist. Merge on the Artists tab instead.');
  if (secondId) return { loserId, survivorId: secondId };
  if (!holder) {
    throw unresolved('No artist holds this Spotify link yet, so the merge target is unknown. Merge on the Artists tab instead.');
  }
  if (holder.id === loserId) {
    throw unresolved('The artist to merge already holds this Spotify link, so there is nothing to merge it into. Reject this item.');
  }
  return { loserId, survivorId: holder.id };
}

async function resolveMerge(db: Db, row: any, link: string) {
  const spotifyId = survivorSpotifyId(row, link);
  const holder = spotifyId ? (await liveArtistsBySpotifyId(db, [spotifyId])).get(spotifyId) : undefined;
  return mergePair(row, holder);
}

/** The context of every pending item on a page, with one query per kind of lookup instead of one per item. */
async function describePending(db: Db, rows: any[]): Promise<Map<string, ItemContext>> {
  const artistIds = new Set<string>();
  const spotifyIds = new Set<string>();
  for (const row of rows) {
    const [first, second] = row.artist_ids as string[];
    if (first) artistIds.add(first);
    if (row.kind !== 'merge') continue;
    if (second) artistIds.add(second);
    const spotifyId = survivorSpotifyId(row, chosenLink(row, {}));
    if (spotifyId) spotifyIds.add(spotifyId);
  }
  const [holders, found] = await Promise.all([
    liveArtistsBySpotifyId(db, [...spotifyIds]),
    artistIds.size ? db.query(`SELECT ${ARTIST_COLUMNS} FROM artists WHERE id = ANY($1::text[])`, [[...artistIds]]) : { rows: [] },
  ]);
  const byId = new Map<string, ArtistRecord>((found.rows as ArtistRecord[]).map((artist) => [artist.id, artist]));
  for (const holder of holders.values()) byId.set(holder.id, holder);

  const pairs = new Map<string, { loserId: string; survivorId: string }>();
  for (const row of rows) {
    if (row.kind !== 'merge') continue;
    const spotifyId = survivorSpotifyId(row, chosenLink(row, {}));
    try {
      pairs.set(row.id, mergePair(row, spotifyId ? holders.get(spotifyId) : undefined));
    } catch (error) {
      // An item that cannot resolve shows no pair or count; its approval then says why. A database failure is not that.
      if (!(error instanceof ArtistError)) throw error;
    }
  }
  const uses = await artistUses(db, [...new Set([...pairs.values()].flatMap((pair) => [pair.loserId, pair.survivorId]))]);

  const context = new Map<string, ItemContext>();
  for (const row of rows) {
    if (row.kind !== 'merge') {
      const artist = byId.get((row.artist_ids as string[])[0] ?? '');
      if (artist) context.set(row.id, { merge: null, current: { name: artistTitle(artist), spotifyUrl: artist.links?.spotify ?? null }, festivalCount: null });
      continue;
    }
    const pair = pairs.get(row.id);
    const loser = pair && byId.get(pair.loserId);
    const survivor = pair && byId.get(pair.survivorId);
    if (!pair || !loser || !survivor) continue;
    const festivals = new Set([pair.loserId, pair.survivorId].flatMap((id) => (uses.get(id) ?? []).map((use) => use.festivalId)));
    context.set(row.id, {
      merge: { ...pair, loserName: artistTitle(loser), survivorName: artistTitle(survivor) },
      current: null,
      festivalCount: festivals.size,
    });
  }
  return context;
}

export function createArtistMatchReviewStore(pool: Pool, artists: ReturnType<typeof createArtistsStore>) {
  return {
    /**
     * Adds the items that are new. An item already in the queue is skipped, except that a pending one takes the new
     * candidates and note when they differ (counted as refined). A decided item is never reopened.
     */
    async importBatch(batch: { generatedAt: string; items: ReviewItemInput[] }, userId: string | null) {
      return withTransactionRetry(pool, async (client) => {
        let added = 0;
        let refined = 0;
        for (const item of batch.items) {
          const { rows } = await client.query(
            `INSERT INTO artist_match_reviews
               (id, item_key, kind, artist_name, festival, artist_ids, candidates, proposed, note, batch_generated_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
             ON CONFLICT (item_key) DO UPDATE
               SET candidates = EXCLUDED.candidates, note = EXCLUDED.note, batch_generated_at = EXCLUDED.batch_generated_at
               WHERE artist_match_reviews.status = 'pending'
                 AND (artist_match_reviews.candidates, artist_match_reviews.note) IS DISTINCT FROM (EXCLUDED.candidates, EXCLUDED.note)
             RETURNING (xmax = 0) AS inserted`,
            [
              createOpaqueId('rev'),
              reviewItemKey(item),
              item.kind,
              item.artistName,
              item.festival,
              JSON.stringify(item.artistIds),
              JSON.stringify(item.candidates),
              JSON.stringify(item.proposed),
              item.note,
              batch.generatedAt,
              userId,
            ],
          );
          if (rows[0]?.inserted) added += 1;
          else if (rows[0]) refined += 1;
        }
        return { added, refined, skipped: batch.items.length - added - refined, total: batch.items.length };
      });
    },

    /** The kind of one item, or null when it does not exist. The route uses it to pick a rate limit. */
    async kindOf(id: string): Promise<ReviewKind | null> {
      const { rows } = await pool.query('SELECT kind FROM artist_match_reviews WHERE id = $1', [id]);
      return (rows[0]?.kind as ReviewKind | undefined) ?? null;
    },

    async list(opts: { status: ReviewStatus | 'all'; limit: number; offset: number }) {
      const status = opts.status === 'all' ? null : opts.status;
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM artist_match_reviews WHERE ($1::text IS NULL OR status = $1) ORDER BY seq LIMIT $2 OFFSET $3`,
        [status, opts.limit, opts.offset],
      );
      const { rows: counted } = await pool.query(
        'SELECT count(*)::int AS total FROM artist_match_reviews WHERE ($1::text IS NULL OR status = $1)',
        [status],
      );
      const context = await describePending(
        pool,
        rows.filter((row) => row.status === 'pending'),
      );
      return { items: rows.map((row) => publicItem(row, context.get(row.id))), total: counted[0].total as number };
    },

    /**
     * Applies one item through the artist store, then closes it, all in one transaction. A link adds the chosen
     * link (a typed one wins); a rename sets proposed.to; a merge merges the loser into the survivor with the
     * survivor's values, and refuses when the survivor is not the `expectedSurvivorId` the admin saw. An admin
     * edit carries no edit token, so the change applies to the artist as it is now.
     */
    async approve(
      id: string,
      input: {
        candidateIndex?: number;
        url?: string;
        acceptedFestivals?: number;
        expectedSurvivorId?: string;
        recentAuth: boolean;
        userId: string | null;
        ip?: string | null;
      },
    ): Promise<{ artistId: string; loserId: string | null; synced: SyncedFestival[] }> {
      try {
        return await withTransactionRetry(pool, async (client) => {
          const { rows } = await client.query(`SELECT ${COLUMNS} FROM artist_match_reviews WHERE id = $1 FOR UPDATE`, [id]);
          const row = rows[0];
          if (!row) throw new ArtistError(404, 'NOT_FOUND', 'Review item not found.');
          if (row.status !== 'pending') throw unresolved('Someone already decided this item. Reload the list.');
          // A merge cannot be undone, so it needs a recent password check, as the Artists tab's merge does.
          if (row.kind === 'merge' && !input.recentAuth) {
            throw new ArtistError(403, 'REAUTH_REQUIRED', 'Confirm your password to continue.');
          }
          const link = chosenLink(row, input);
          const via = { reviewId: id, via: 'artist-review' };
          let artistId: string;
          let loserId: string | null = null;
          let synced: SyncedFestival[];
          if (row.kind === 'merge') {
            if (input.acceptedFestivals === undefined) throw invalid('Say how many festivals you reviewed (acceptedFestivals).');
            const pair = await resolveMerge(client, row, link);
            if (!input.expectedSurvivorId) throw invalid('Say which artist you reviewed as the survivor (expectedSurvivorId).');
            if (pair.survivorId !== input.expectedSurvivorId) {
              throw unresolved('The artist this merge keeps is not the one you reviewed. Reload the list and review the merge again.');
            }
            const [survivor, loser] = await Promise.all([artists.getById(pair.survivorId, client), artists.getById(pair.loserId, client)]);
            if (!survivor || !loser) throw new ArtistError(404, 'NOT_FOUND', 'Artist not found.');
            const token = (artist: ArtistRecord) => new Date(artist.updated_at as unknown as string).toISOString();
            const merged = await artists.merge({
              ...pair,
              survivorUpdatedAt: token(survivor),
              loserUpdatedAt: token(loser),
              pick: {},
              acceptedFestivals: input.acceptedFestivals,
              userId: input.userId,
              ip: input.ip,
              via,
              client,
            });
            artistId = pair.survivorId;
            loserId = pair.loserId;
            synced = merged.synced;
          } else {
            if (row.kind === 'link' && !link) throw invalid('Pick a candidate or type a link first.');
            if (row.kind === 'rename' && !row.proposed.to) throw invalid('This rename has no new name.');
            artistId = await resolveArtist(client, row, artists);
            const changes = row.kind === 'link' ? { addLink: link } : { name: row.proposed.to as string };
            const outcome = await artists.updateWithin(client, artistId, { changes, userId: input.userId, ip: input.ip, via });
            synced = outcome.status === 'updated' ? outcome.synced : [];
          }
          await client.query(
            `UPDATE artist_match_reviews SET status = 'approved', chosen_url = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
            [id, link || null, input.userId],
          );
          return { artistId, loserId, synced };
        });
      } catch (error) {
        throw artistConflict(error) ?? error;
      }
    },

    async reject(id: string, input: { note?: string | null; userId: string | null }) {
      const { rowCount } = await pool.query(
        `
  UPDATE artist_match_reviews
  SET
    status = 'rejected',
    decision_note = $2,
    decided_by = $3,
    decided_at = now()
  WHERE
    id = $1
    AND status = 'pending'
`,
        [id, input.note ? input.note.slice(0, 500) : null, input.userId],
      );
      if (rowCount) return;
      const { rows } = await pool.query('SELECT 1 FROM artist_match_reviews WHERE id = $1', [id]);
      throw rows[0] ? unresolved('Someone already decided this item. Reload the list.') : new ArtistError(404, 'NOT_FOUND', 'Review item not found.');
    },
  };
}
