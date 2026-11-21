import { api } from './api';

// The admin artist review queue (routes/artists.ts, /admin/artists/review): researched link, merge and rename
// proposals that an admin approves one by one.

export type ArtistReviewKind = 'link' | 'merge' | 'rename';
export type ArtistReviewStatus = 'pending' | 'approved' | 'rejected';
export type ArtistReviewConfidence = 'high' | 'medium' | 'low';

export interface ArtistReviewCandidate {
  /** An open.spotify.com artist link, or empty (a rename has none). */
  spotifyUrl: string;
  otherUrls: string[];
  confidence: ArtistReviewConfidence;
  /** Plain text. Render it as text, never as markup. */
  evidence: string;
}

export interface ArtistReviewItem {
  id: string;
  kind: ArtistReviewKind;
  artistName: string;
  festival: string;
  artistIds: string[];
  candidates: ArtistReviewCandidate[];
  proposed: { from: string; to: string };
  note: string;
  status: ArtistReviewStatus;
  chosenUrl: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** A pending merge only: the festivals that list either artist. Send it back as acceptedFestivals. */
  festivalCount: number | null;
  /** A pending merge only: who is merged into whom. Send merge.survivorId back as expectedSurvivorId. */
  merge: { loserId: string; loserName: string; survivorId: string; survivorName: string } | null;
  /** A pending link or rename only: the artist as it is now. */
  current: { name: string; spotifyUrl: string | null } | null;
}

export interface ArtistReviewPage {
  items: ArtistReviewItem[];
  total: number;
}

const enc = encodeURIComponent;

export const fetchArtistReview = (status: ArtistReviewStatus | 'all' = 'pending', limit = 50, offset = 0) =>
  api.get<ArtistReviewPage>(`/admin/artists/review?status=${status}&limit=${limit}&offset=${offset}`);

export const importArtistReview = (batch: unknown) =>
  api.post<{ added: number; refined: number; skipped: number; total: number }>('/admin/artists/review/import', batch);

/** A link item sends the chosen candidate or a typed link. A merge also sends acceptedFestivals and expectedSurvivorId, and needs a recent re-auth. */
export const approveArtistReview = (
  id: string,
  body: { candidateIndex?: number; url?: string; acceptedFestivals?: number; expectedSurvivorId?: string } = {},
) =>
  api.post<{ status: 'approved'; artistId: string; festivalsUpdated: number }>(`/admin/artists/review/${enc(id)}/approve`, body);

export const rejectArtistReview = (id: string, note?: string) =>
  api.post<{ status: 'rejected' }>(`/admin/artists/review/${enc(id)}/reject`, note ? { note } : {});

/** Reads the text of a batch file. The server checks every field; this only catches a bad paste early. */
export function parseArtistReviewBatch(text: string): { ok: true; batch: unknown; count: number } | { ok: false; message: string } {
  let batch: unknown;
  try {
    batch = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That is not valid JSON. Paste the whole file.' };
  }
  const items = (batch as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0) return { ok: false, message: 'The batch needs an "items" list with at least one item.' };
  return { ok: true, batch, count: items.length };
}
