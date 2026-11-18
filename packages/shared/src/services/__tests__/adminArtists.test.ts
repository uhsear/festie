import { describe, it, expect, vi, afterEach } from 'vitest';
import { setAuthToken, ApiClientError } from '../api';
import {
  artistTitle,
  changeEverywhereText,
  changedArtistFrom,
  createArtist,
  findSpotifyCandidates,
  followersText,
  listFestivalArtists,
  matchArtists,
  pickSpotifyCandidates,
  updateArtist,
} from '../adminArtists';

const res = (status: number, body: unknown) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    headers: { get: () => null },
    json: async () => body,
  }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setAuthToken(null);
});

describe('admin artist routes', () => {
  it("lists a festival's artists with the festival id encoded", async () => {
    const spy = vi.fn(async () => res(200, { data: { artists: [{ id: 'art-1' }] }, error: null }));
    vi.stubGlobal('fetch', spy);
    await expect(listFestivalArtists('f 1')).resolves.toEqual([{ id: 'art-1' }]);
    expect((spy.mock.calls[0] as unknown as [string])[0]).toContain('/admin/artists?festivalId=f%201');
  });

  it('matches names in one call', async () => {
    const spy = vi.fn(async () =>
      res(200, { data: { results: [{ name: 'HOL', outcome: 'pick', candidates: [] }] }, error: null }),
    );
    vi.stubGlobal('fetch', spy);
    const out = await matchArtists([{ name: 'HOL' }]);
    expect(out[0]?.outcome).toBe('pick');
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/admin/artists/match');
    expect(init.body).toBe(JSON.stringify({ items: [{ name: 'HOL' }] }));
  });

  it('creates and patches an artist with the edit token', async () => {
    const spy = vi
      .fn()
      .mockResolvedValueOnce(res(201, { data: { artist: { id: 'art-2' } }, error: null }))
      .mockResolvedValueOnce(res(200, { data: { artist: { id: 'art-2' }, festivalsUpdated: 2 }, error: null }));
    vi.stubGlobal('fetch', spy);
    await expect(createArtist({ name: 'HOL', label: 'UK' })).resolves.toEqual({ id: 'art-2' });
    await expect(
      updateArtist('art-2', '2026-01-01T00:00:00.000Z', { addLink: 'https://x.com/hol' }),
    ).resolves.toMatchObject({ festivalsUpdated: 2 });
    const [url, init] = spy.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain('/admin/artists/art-2');
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(
      JSON.stringify({ expectedUpdatedAt: '2026-01-01T00:00:00.000Z', changes: { addLink: 'https://x.com/hol' } }),
    );
  });

  it('reads the current artist out of a 409 ARTIST_CHANGED', () => {
    const current = { id: 'art-2', name: 'HOL' };
    const error = new ApiClientError('changed', 409, 'ARTIST_CHANGED', undefined, false, { artist: current });
    expect(changedArtistFrom(error)).toEqual(current);
    expect(changedArtistFrom(new ApiClientError('x', 409, 'FESTIVAL_CHANGED'))).toBeNull();
    expect(changedArtistFrom(new Error('x'))).toBeNull();
  });
});

describe('artist copy', () => {
  it('writes the change-everywhere question and the title with a note', () => {
    expect(changeEverywhereText('Avello', 2)).toBe('Avello is also on 2 festivals, including past ones. Change it everywhere?');
    expect(changeEverywhereText('Avello', 1)).toBe('Avello is also on 1 festival, including past ones. Change it everywhere?');
    expect(artistTitle({ name: 'HOL', label: 'UK' })).toBe('HOL (UK)');
    expect(artistTitle({ name: 'HOL', label: '' })).toBe('HOL');
  });
});

describe('Spotify candidates', () => {
  it('asks for the candidates of one festival and sends nothing else', async () => {
    const spy = vi.fn(async () => res(200, { data: { artists: [], notSearched: 0, searchFailed: 0 }, error: null }));
    vi.stubGlobal('fetch', spy);
    await expect(findSpotifyCandidates('f1')).resolves.toEqual({ artists: [], notSearched: 0, searchFailed: 0 });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/admin/artists/spotify-candidates');
    expect(init.body).toBe(JSON.stringify({ festivalId: 'f1' }));
  });

  it('sends the artists to leave out', async () => {
    const spy = vi.fn(async () => res(200, { data: { artists: [], notSearched: 0, searchFailed: 0 }, error: null }));
    vi.stubGlobal('fetch', spy);
    await findSpotifyCandidates('f1', ['a1', 'a2']);
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ festivalId: 'f1', exclude: ['a1', 'a2'] }));
  });

  it('sends the picks with the artist token and only the Spotify id, and returns each row', async () => {
    const spy = vi.fn(async () =>
      res(200, { data: { results: [{ artistId: 'art-1', status: 'shared', alsoOn: 2 }] }, error: null }),
    );
    vi.stubGlobal('fetch', spy);
    const picks = [{ artistId: 'art-1', expectedUpdatedAt: '2026-01-01T00:00:00.000Z', spotifyId: 'x'.repeat(22), acceptShared: false }];
    await expect(pickSpotifyCandidates('f1', picks)).resolves.toEqual([{ artistId: 'art-1', status: 'shared', alsoOn: 2 }]);
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/admin/artists/spotify-picks');
    expect(init.body).toBe(JSON.stringify({ festivalId: 'f1', picks }));
  });

  it('writes followers in short form', () => {
    expect(followersText(null)).toBeNull();
    expect(followersText(1)).toBe('1 follower');
    expect(followersText(950)).toBe('950 followers');
    expect(followersText(12_340)).toBe('12.3K followers');
    expect(followersText(1_250_000)).toBe('1.3M followers');
    expect(followersText(999_949)).toBe('999.9K followers');
    expect(followersText(999_950)).toBe('1M followers');
  });
});
