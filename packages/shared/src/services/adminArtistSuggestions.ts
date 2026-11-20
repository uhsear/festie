import { api } from './api';

// The admin side of organizer artist suggestions (routes/artists.ts): an organizer's change to an artist that another
// organization or an admin-only festival also uses, and every organizer Spotify change, waits here for a decision.

export type ArtistSuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface ArtistSuggestionChanges {
  name?: string;
  label?: string;
  /** One raw link. The server detects the platform from the host. */
  addLink?: string;
  removeLinks?: string[];
  /** Sets or, with null, clears the Spotify link (the set-link route sends this). */
  spotifyLink?: string | null;
}

export interface ArtistSuggestion {
  id: string;
  status: ArtistSuggestionStatus;
  changes: ArtistSuggestionChanges;
  /** The admin's note, once decided. The organization reads it. */
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  artist: { id: string; name: string; label: string; links: Record<string, string>; mergedInto: string | null };
  organization: { id: string; name: string } | null;
  festival: { id: string; name: string } | null;
  /** A username, never an email address. */
  createdBy: string | null;
  /** The festivals that list the artist, archived ones too: where an accepted change lands. */
  festivalCount: number;
}

const enc = encodeURIComponent;

export const fetchArtistSuggestions = async (status: ArtistSuggestionStatus | 'all' = 'pending') =>
  (await api.get<{ suggestions: ArtistSuggestion[] }>(`/admin/artists/suggestions?status=${status}`)).suggestions;

export const decideArtistSuggestion = (id: string, decision: 'accept' | 'reject', note?: string) =>
  api.post<{ status: 'accepted' | 'rejected'; artistId: string; festivalsUpdated: number }>(
    `/admin/artists/suggestions/${enc(id)}/decision`,
    { decision, ...(note ? { note } : {}) },
  );

/** One plain sentence per requested change, for the review list. */
export function describeSuggestedChanges(changes: ArtistSuggestionChanges): string[] {
  const lines: string[] = [];
  if (changes.name !== undefined) lines.push(`Rename it to "${changes.name}"`);
  if (changes.label !== undefined) lines.push(changes.label ? `Set the note to "${changes.label}"` : 'Clear the note');
  if (changes.addLink !== undefined) lines.push(`Add the link ${changes.addLink}`);
  if (changes.spotifyLink !== undefined) {
    lines.push(changes.spotifyLink ? `Set the Spotify link to ${changes.spotifyLink}` : 'Remove the Spotify link');
  }
  if (changes.removeLinks?.length) lines.push(`Remove the ${changes.removeLinks.join(', ')} link`);
  return lines;
}
