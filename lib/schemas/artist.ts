// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { identifier } from './primitives';

// ── Set link schema (admin) ──────────────────────────────────────
// https-only to avoid javascript:/data: schemes (mirrors crewPhotoAlbumSchema).
export const setLinkSchema = z.object({
  linkUrl: z
    .string()
    .url('Must be a valid URL')
    .max(500)
    .refine((u) => u.startsWith('https://'), 'Must be an https URL')
    .nullable()
    .optional()
    .or(z.literal('')),
  // Which artist of a B2B set the link belongs to (default 0).
  artistIndex: z.number().int().min(0).max(3).optional(),
});

// ── Artist schemas (admin) ───────────────────────────────────────
// The artist routes check links with lib/artist-links.ts, so a raw link is only length-bounded here.
export const artistMatchSchema = z.object({
  items: z
    .array(z.object({ name: z.string().max(300), spotify: z.string().max(500).nullable().optional() }))
    .min(1)
    .max(500),
});

export const artistCreateSchema = z.object({
  name: z.string().trim().min(1).max(300),
  // The note that tells same-name artists apart. Required when another artist has the name.
  label: z.string().max(200).optional(),
  link: z.string().max(500).optional(),
});

export const artistUpdateSchema = z.object({
  // The artist's updatedAt the editor loaded (millisecond precision).
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  changes: z
    .object({
      name: z.string().max(300).optional(),
      label: z.string().max(200).optional(),
      addLink: z.string().max(500).optional(),
      removeLinks: z.array(z.string().max(40)).max(12).optional(),
    })
    .refine((c) => Object.values(c).some((v) => v !== undefined), 'At least one change required'),
});

// Organizer artist routes (/manage/artists). `organizationId` names which of the caller's organizations a write is for;
// it defaults to the first one the caller may write for.
export const organizerArtistCreateSchema = artistCreateSchema.extend({ organizationId: identifier.optional() });
export const organizerArtistUpdateSchema = artistUpdateSchema.extend({ organizationId: identifier.optional() });
export const organizerArtistListQuerySchema = z.object({
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

// Admin: the organizer suggestions that wait for a decision.
export const artistSuggestionListQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export const artistSuggestionDecisionSchema = z.object({
  decision: z.enum(['accept', 'reject']),
  // Shown to the organization that sent the suggestion.
  note: z.string().trim().max(500).optional(),
});

export const artistListQuerySchema = z.object({
  festivalId: z.string().max(100).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  // "Possible duplicates": artists with the same name key or a key one character apart, on any festival.
  duplicates: z.enum(['true']).optional(),
});

// Merge the artist in the path (the survivor) with `loserId`. Admin only, web only, behind a recent re-auth.
const mergeSide = z.enum(['survivor', 'loser']);
export const artistMergeSchema = z.object({
  loserId: identifier,
  // Each artist's updatedAt the editor loaded (millisecond precision).
  survivorUpdatedAt: z.string().datetime({ offset: true }),
  loserUpdatedAt: z.string().datetime({ offset: true }),
  // How many festivals, archived ones included, the editor saw in the preview. The server counts again under its locks and refuses a higher count.
  acceptedFestivals: z.number().int().min(0).max(10_000),
  // Per field, which artist's value the merged artist keeps. A field left out keeps the survivor's.
  pick: z
    .object({
      name: mergeSide.optional(),
      label: mergeSide.optional(),
      photo: mergeSide.optional(),
      genres: mergeSide.optional(),
      links: z.record(z.string().max(40), mergeSide).refine((links) => Object.keys(links).length <= 12, 'Too many link choices').optional(),
    })
    .optional(),
});

// The artist id backfill. `run` needs a recent re-auth; the other two modes write nothing.
export const artistBackfillSchema = z.object({
  mode: z.enum(['dry-run', 'run', 'verify']),
  // The planHash of the reviewed dry run. `run` refuses with 409 PLAN_CHANGED when the plan it computes differs.
  planHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

// The policy-update notice email. `send` needs a recent re-auth; `dry-run` only counts recipients.
// noticeId keys the idempotency ledger, so one id is one notice. html is the admin's own markup; without it the mail is built from the escaped text.
export const policyNoticeSchema = z
  .object({
    noticeId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),
    // No CR or LF: the subject becomes a mail header, so a line break would inject headers.
    subject: z.string().trim().min(1).max(150).regex(/^[^\r\n]+$/),
    text: z.string().trim().min(1).max(20000),
    html: z.string().trim().min(1).max(100000).optional(),
    mode: z.enum(['dry-run', 'send']),
  })
  .strict();

// "Find Spotify links": the candidates for the artists on one festival, and the editor's picks.
export const artistSpotifyCandidatesSchema = z.object({
  festivalId: identifier,
  // Artists the editor skipped or Spotify could not match. They leave the search so the next ones reach it.
  exclude: z.array(identifier).max(1000).optional(),
});

export const artistSpotifyPicksSchema = z.object({
  festivalId: identifier,
  picks: z
    .array(
      z.object({
        artistId: identifier,
        // The artist's updatedAt the editor loaded (millisecond precision).
        expectedUpdatedAt: z.string().datetime({ offset: true }),
        // Spotify's 22-character artist id. The server builds the link and reads the photo and genres from Spotify.
        spotifyId: z.string().regex(/^[A-Za-z0-9]{22}$/, 'Not a Spotify artist id'),
        // How many other festivals the editor confirmed the artist is on. The server counts again under the locks and refuses a higher count.
        acceptedAlsoOn: z.number().int().min(0).max(10_000).optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const artistSpotifyRefreshSchema = z.object({ festivalId: identifier });

// Spotify backfill body. All optional: old mobile bundles post no body.
export const spotifyBackfillSchema = z
  .object({
    // `force` is gone: a guess never overwrites a link. An old client that sends it is ignored (keys are stripped).
    skipSearch: z.boolean().optional(),
    // Artist name -> verified link, preferred over search.
    overrides: z
      .record(
        z.string().trim().min(1).max(200),
        // url() alone accepts javascript: and data: links.
        z
          .string()
          .url()
          .max(500)
          .refine((u) => u.startsWith('https://'), 'Must be an https URL'),
      )
      .refine((o) => Object.keys(o).length <= 500, 'At most 500 overrides')
      .optional(),
    // Limits the run to these sets.
    setIds: z.array(identifier).max(500).optional(),
  })
  .default({});

// ── Artist review queue (admin) ──────────────────────────────────
// A researched batch of link, merge and rename proposals. Every URL is https, so no javascript: or data: link
// reaches the page. A Spotify candidate must sit on open.spotify.com; the artist-link rules check its shape on approval.
const httpsUrl = (host?: string) =>
  z
    .string()
    .max(500)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && (host ? url.hostname === host : true);
      } catch {
        return false;
      }
    }, host ? `Must be an https URL on ${host}` : 'Must be a well-formed https URL');

const ARTIST_REVIEW_KINDS = ['link', 'merge', 'rename'] as const;

const artistReviewCandidate = z.object({
  // A rename carries no link, so an empty string is allowed.
  spotifyUrl: z.union([z.literal(''), httpsUrl('open.spotify.com')]),
  otherUrls: z.array(httpsUrl()).max(20).default([]),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string().max(2000).default(''),
});

const artistReviewItem = z.object({
  kind: z.enum(ARTIST_REVIEW_KINDS),
  artistName: z.string().trim().min(1).max(300),
  festival: z.string().max(300).default(''),
  artistIds: z.array(identifier).max(10).default([]),
  candidates: z.array(artistReviewCandidate).max(10).default([]),
  proposed: z.object({ from: z.string().max(500).default(''), to: z.string().max(500).default('') }).default({ from: '', to: '' }),
  note: z.string().max(2000).default(''),
});

export const artistReviewImportSchema = z.object({
  generatedAt: z.string().min(1).max(40),
  items: z.array(artistReviewItem).min(1).max(200),
});

export const artistReviewListQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
});

export const artistReviewApproveSchema = z.object({
  // Which candidate to apply, or a link typed over it. A link item needs one of the two.
  candidateIndex: z.number().int().min(0).max(9).optional(),
  url: httpsUrl().optional(),
  // A merge only: how many festivals the admin saw in the preview. The server recounts and refuses a higher count.
  acceptedFestivals: z.number().int().min(0).max(10_000).optional(),
  // A merge only: the artist the admin saw as the survivor. The server refuses the merge when it resolves to another.
  expectedSurvivorId: identifier.optional(),
});

export const artistReviewRejectSchema = z.object({ note: z.string().trim().max(500).optional() });
