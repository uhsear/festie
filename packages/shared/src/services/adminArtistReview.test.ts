import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./api', () => ({ api }));

import { approveArtistReview, fetchArtistReview, importArtistReview, parseArtistReviewBatch, rejectArtistReview } from './adminArtistReview';

beforeEach(() => vi.clearAllMocks());

describe('artist review routes', () => {
  it('lists a page of pending items by default', async () => {
    await fetchArtistReview();
    await fetchArtistReview('all', 10, 20);
    expect(api.get).toHaveBeenCalledWith('/admin/artists/review?status=pending&limit=50&offset=0');
    expect(api.get).toHaveBeenCalledWith('/admin/artists/review?status=all&limit=10&offset=20');
  });

  it('imports a batch as given', async () => {
    const batch = { generatedAt: 'x', items: [] };
    await importArtistReview(batch);
    expect(api.post).toHaveBeenCalledWith('/admin/artists/review/import', batch);
  });

  it('approves and rejects with an encoded id, and sends the note only when there is one', async () => {
    await approveArtistReview('rev/1', { candidateIndex: 1, acceptedFestivals: 3 });
    await rejectArtistReview('rev 2', 'wrong act');
    await rejectArtistReview('rev 3');
    expect(api.post).toHaveBeenCalledWith('/admin/artists/review/rev%2F1/approve', { candidateIndex: 1, acceptedFestivals: 3 });
    expect(api.post).toHaveBeenCalledWith('/admin/artists/review/rev%202/reject', { note: 'wrong act' });
    expect(api.post).toHaveBeenCalledWith('/admin/artists/review/rev%203/reject', {});
  });
});

describe('parseArtistReviewBatch', () => {
  it('accepts a batch with items and counts them', () => {
    expect(parseArtistReviewBatch('{"generatedAt":"x","items":[{},{}]}')).toEqual({ ok: true, batch: { generatedAt: 'x', items: [{}, {}] }, count: 2 });
  });

  it('refuses broken JSON, a missing list and an empty list', () => {
    for (const text of ['{nope', '[]', 'null', '{"items":[]}', '{"items":"x"}']) {
      const result = parseArtistReviewBatch(text);
      expect(result.ok).toBe(false);
    }
  });
});
