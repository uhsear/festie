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
  ArtistError,
  artistConflict,
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

/** The same item, imported twice, hashes to the same key. Candidates are left out: a re-run may refine them. */
function reviewItemKey(item: ReviewItemInput): string {
  const parts = [
    item.kind,
    item.artistName.trim().toLowerCase(),
    item.festival.trim(),
    [...item.artistIds].sort(),
    item.proposed.from,
    item.proposed.to,
  ];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function publicItem(row: any, festivalCount: number | null) {
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
    festivalCount,
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

/** The live artist a link or rename applies to: the id the batch names, else the one live artist with that name. */
async function resolveArtist(db: Db, row: any): Promise<string> {
  const named = (row.artist_ids as string[])[0];
  if (named) return named;
  const name: string = row.kind === 'rename' ? row.proposed.from || row.artist_name : row.artist_name;
  const key = artistNameKey(name);
  const live = (await liveArtistsByKey(db, [key])).get(key) ?? [];
  const only = live.length === 1 ? live[0] : undefined;
  if (only) return only.id;
  throw unresolved(
    live.length === 0
      ? `No artist is named ${name}. Fix the name on the Artists tab, then approve again.`
      : `${live.length} artists are named ${name}. Merge or rename them on the Artists tab, then approve again.`,
  );
}

/** A merge: the artist merged away is the first id; the survivor is the second id, else the holder of the chosen Spotify artist. */
async function resolveMerge(db: Db, row: any, link: string) {
  const [loserId, secondId] = row.artist_ids as string[];
  if (!loserId) throw unresolved('This merge names no artist. Merge on the Artists tab instead.');
  let survivorId = secondId;
  if (!survivorId) {
    const spotify = link ? normalizeArtistLink('spotify', link) : null;
    const spotifyId = spotify?.ok ? spotify.spotifyId : undefined;
    const holder = spotifyId ? (await liveArtistsBySpotifyId(db, [spotifyId])).get(spotifyId) : undefined;
    if (!holder) {
      throw unresolved('No artist holds this Spotify link yet, so the merge target is unknown. Merge on the Artists tab instead.');
    }
    survivorId = holder.id;
  }
  return { loserId: loserId as string, survivorId: survivorId as string };
}

async function festivalCountOf(db: Db, ids: string[]) {
  const uses = await artistUses(db, ids);
  return new Set(ids.flatMap((id) => (uses.get(id) ?? []).map((use) => use.festivalId))).size;
}

export function createArtistMatchReviewStore(pool: Pool, artists: ReturnType<typeof createArtistsStore>) {
  return {
    /** Adds the items that are new. An item already in the queue, decided or not, is skipped. */
    async importBatch(batch: { generatedAt: string; items: ReviewItemInput[] }, userId: string | null) {
      return withTransactionRetry(pool, async (client) => {
        let added = 0;
        for (const item of batch.items) {
          const { rowCount } = await client.query(
            `INSERT INTO artist_match_reviews
               (id, item_key, kind, artist_name, festival, artist_ids, candidates, proposed, note, batch_generated_at, created_by)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
             ON CONFLICT (item_key) DO NOTHING`,
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
          added += rowCount ?? 0;
        }
        return { added, skipped: batch.items.length - added, total: batch.items.length };
      });
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
      const items = [];
      for (const row of rows) {
        let festivalCount: number | null = null;
        if (row.kind === 'merge' && row.status === 'pending') {
          // An item that cannot resolve shows no count; its approval then says why.
          const pair = await resolveMerge(pool, row, chosenLink(row, {})).catch(() => null);
          if (pair) festivalCount = await festivalCountOf(pool, [pair.loserId, pair.survivorId]);
        }
        items.push(publicItem(row, festivalCount));
      }
      return { items, total: counted[0].total as number };
    },

    /**
     * Applies one item through the artist store, then closes it, all in one transaction. A link adds the chosen
     * link (a typed one wins); a rename sets proposed.to; a merge merges the loser into the survivor with the
     * survivor's values. An admin edit carries no edit token, so the change applies to the artist as it is now.
     */
    async approve(
      id: string,
      input: { candidateIndex?: number; url?: string; acceptedFestivals?: number; recentAuth: boolean; userId: string | null; ip?: string | null },
    ): Promise<{ artistId: string; synced: SyncedFestival[] }> {
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
          let artistId: string;
          let synced: SyncedFestival[];
          if (row.kind === 'merge') {
            if (input.acceptedFestivals === undefined) throw invalid('Say how many festivals you reviewed (acceptedFestivals).');
            const pair = await resolveMerge(client, row, link);
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
              client,
            });
            artistId = pair.survivorId;
            synced = merged.synced;
          } else {
            if (row.kind === 'link' && !link) throw invalid('Pick a candidate or type a link first.');
            if (row.kind === 'rename' && !row.proposed.to) throw invalid('This rename has no new name.');
            artistId = await resolveArtist(client, row);
            const changes = row.kind === 'link' ? { addLink: link } : { name: row.proposed.to as string };
            const via = { reviewId: id, via: 'artist-review' };
            const outcome = await artists.updateWithin(client, artistId, { changes, userId: input.userId, ip: input.ip, via });
            synced = outcome.status === 'updated' ? outcome.synced : [];
          }
          await client.query(
            `UPDATE artist_match_reviews SET status = 'approved', chosen_url = $2, decided_by = $3, decided_at = now() WHERE id = $1`,
            [id, link || null, input.userId],
          );
          return { artistId, synced };
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
