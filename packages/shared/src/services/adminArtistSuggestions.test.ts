import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./api', () => ({ api }));

import { decideArtistSuggestion, describeSuggestedChanges, fetchArtistSuggestions } from './adminArtistSuggestions';

beforeEach(() => vi.clearAllMocks());

describe('artist suggestion routes', () => {
  it('lists the pending suggestions by default and unwraps them', async () => {
    api.get.mockResolvedValue({ suggestions: [{ id: 's1' }] });
    expect(await fetchArtistSuggestions()).toEqual([{ id: 's1' }]);
    expect(api.get).toHaveBeenCalledWith('/admin/artists/suggestions?status=pending');
    await fetchArtistSuggestions('all');
    expect(api.get).toHaveBeenCalledWith('/admin/artists/suggestions?status=all');
  });

  it('decides with an encoded id and sends the note only when there is one', async () => {
    await decideArtistSuggestion('s 1', 'accept');
    await decideArtistSuggestion('s/2', 'reject', 'Not the same artist.');
    expect(api.post).toHaveBeenCalledWith('/admin/artists/suggestions/s%201/decision', { decision: 'accept' });
    expect(api.post).toHaveBeenCalledWith('/admin/artists/suggestions/s%2F2/decision', { decision: 'reject', note: 'Not the same artist.' });
  });
});

describe('describeSuggestedChanges', () => {
  it('writes one sentence per change', () => {
    expect(
      describeSuggestedChanges({ name: 'New', label: '', addLink: 'https://x.example/a', spotifyLink: null, removeLinks: ['instagram', 'website'] }),
    ).toEqual([
      'Rename it to "New"',
      'Clear the note',
      'Add the link https://x.example/a',
      'Remove the Spotify link',
      'Remove the instagram, website link',
    ]);
    expect(describeSuggestedChanges({ label: 'UK', spotifyLink: 'https://open.spotify.com/artist/x' })).toEqual([
      'Set the note to "UK"',
      'Set the Spotify link to https://open.spotify.com/artist/x',
    ]);
    expect(describeSuggestedChanges({})).toEqual([]);
  });
});
