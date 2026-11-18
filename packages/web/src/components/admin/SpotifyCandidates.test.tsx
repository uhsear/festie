import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const toastError = vi.fn();
const findSpotifyCandidates = vi.fn();
const pickSpotifyCandidates = vi.fn();

vi.mock('@festie/shared/services', async (orig) => ({
  ...(await orig<typeof import('@festie/shared/services')>()),
  findSpotifyCandidates: (...a: unknown[]) => findSpotifyCandidates(...a),
  pickSpotifyCandidates: (...a: unknown[]) => pickSpotifyCandidates(...a),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError }) }));

import SpotifyCandidates from './SpotifyCandidates';

const artist = (over: Record<string, unknown> = {}) => ({
  id: 'art-1',
  name: 'Avello',
  label: '',
  links: {},
  photo: null,
  genres: [],
  spotifyId: null,
  updatedAt: '2026-06-01T00:00:00.000Z',
  alsoOn: 0,
  sameName: false,
  linkCount: 0,
  ...over,
});
const candidate = (n: number, name: string, over: Record<string, unknown> = {}) => ({
  spotifyId: `id${n}`.padEnd(22, 'x'),
  spotifyUrl: `https://open.spotify.com/artist/id${n}`,
  name,
  imageUrl: `https://i.scdn.co/image/${n}`,
  followers: 12_300,
  genres: ['house', 'techno'],
  exact: false,
  linkedTo: null,
  ...over,
});
const row = (a: Record<string, unknown>, candidates: unknown[], singleExact = false) => ({ artist: artist(a), candidates, singleExact });

const avello = () => row({}, [candidate(1, 'Avello', { exact: true }), candidate(2, 'Avello Two')], true);
const hol = () =>
  row({ id: 'art-2', name: 'HOL', label: 'UK', sameName: true }, [candidate(3, 'HOL', { exact: true }), candidate(4, 'HOL!', { exact: true })]);
const cyclops = () => row({ id: 'art-3', name: 'Cyclops', alsoOn: 2 }, [candidate(5, 'Cyclops', { exact: true })], true);

const onApplied = vi.fn();
const onClose = vi.fn();
async function open(rows: unknown[], extra: Record<string, unknown> = {}) {
  findSpotifyCandidates.mockResolvedValue({ artists: rows, notSearched: 0, searchFailed: 0, ...extra });
  render(<SpotifyCandidates festivalId="f1" onApplied={onApplied} onClose={onClose} />);
  await screen.findByText(/no Spotify link/);
}
const saved = (artistId: string) => ({ artistId, status: 'saved', artist: artist({ id: artistId }) });

describe('SpotifyCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the candidates with photo, followers and genres, and stores nothing by itself', async () => {
    await open([avello()]);
    expect(findSpotifyCandidates).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('12.3K followers · house, techno')).toHaveLength(2);
    expect(document.querySelector('img[src="https://i.scdn.co/image/1"]')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Pick / })).toHaveLength(2);
    expect(pickSpotifyCandidates).not.toHaveBeenCalled();
  });

  it('a pick sends the Spotify id with the artist token, then drops the row and reloads the list', async () => {
    pickSpotifyCandidates.mockResolvedValue([saved('art-1')]);
    await open([avello()]);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Avello Two for Avello' }));
    await waitFor(() =>
      expect(pickSpotifyCandidates).toHaveBeenCalledWith('f1', [
        { artistId: 'art-1', expectedUpdatedAt: '2026-06-01T00:00:00.000Z', spotifyId: 'id2'.padEnd(22, 'x') },
      ]),
    );
    await waitFor(() => expect(screen.queryByText('Avello Two')).toBeNull());
    expect(onApplied).toHaveBeenCalled();
  });

  it('None of these hides the row and stores nothing', async () => {
    await open([avello(), hol()]);
    fireEvent.click(screen.getByRole('button', { name: 'None of these for Avello' }));
    expect(screen.queryByText('Avello Two')).toBeNull();
    expect(screen.getByText('HOL!')).toBeTruthy();
    expect(pickSpotifyCandidates).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('a same-name artist shows each candidate to pick by hand and is not part of the confirm-all count', async () => {
    await open([avello(), hol()]);
    expect(screen.getByText('HOL (UK)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm all single exact matches (1)' })).toBeTruthy();
  });

  it('Confirm all sends only the single exact matches, with the exact candidate', async () => {
    pickSpotifyCandidates.mockResolvedValue([saved('art-1')]);
    await open([avello(), hol()]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm all single exact matches (1)' }));
    await waitFor(() => expect(pickSpotifyCandidates).toHaveBeenCalledTimes(1));
    const picks = pickSpotifyCandidates.mock.calls[0]![1] as Array<{ artistId: string; spotifyId: string }>;
    expect(picks.map((p) => [p.artistId, p.spotifyId])).toEqual([['art-1', 'id1'.padEnd(22, 'x')]]);
  });

  it('a candidate that another artist holds cannot be picked', async () => {
    await open([row({}, [candidate(6, 'Avello', { exact: true, linkedTo: 'Avello (NL)' })])]);
    expect(screen.getByText('Already linked to Avello (NL). Possible duplicate.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Pick Avello for Avello' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a pick on an artist that is on other festivals asks first and sends acceptShared only after Change everywhere', async () => {
    pickSpotifyCandidates.mockResolvedValue([saved('art-3')]);
    await open([cyclops()]);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Cyclops for Cyclops' }));
    expect(await screen.findByText('Cyclops is also on 2 festivals, including past ones. Change it everywhere?')).toBeTruthy();
    expect(pickSpotifyCandidates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Change everywhere'));
    await waitFor(() =>
      expect(pickSpotifyCandidates).toHaveBeenCalledWith('f1', [
        { artistId: 'art-3', expectedUpdatedAt: '2026-06-01T00:00:00.000Z', spotifyId: 'id5'.padEnd(22, 'x'), acceptShared: true },
      ]),
    );
  });

  it('when the server finds the artist on other festivals, it asks and sends the pick again with acceptShared', async () => {
    pickSpotifyCandidates
      .mockResolvedValueOnce([{ artistId: 'art-1', status: 'shared', alsoOn: 1 }])
      .mockResolvedValueOnce([saved('art-1')]);
    await open([avello()]);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Avello for Avello' }));
    expect(await screen.findByText('Avello is also on 1 festival, including past ones. Change it everywhere?')).toBeTruthy();
    expect(screen.getByText('Avello', { selector: 'span' })).toBeTruthy();
    fireEvent.click(screen.getByText('Change everywhere'));
    await waitFor(() => expect(pickSpotifyCandidates).toHaveBeenCalledTimes(2));
    expect((pickSpotifyCandidates.mock.calls[1]![1] as Array<{ acceptShared?: boolean }>)[0]!.acceptShared).toBe(true);
  });

  it('shows a refused pick on its own row and keeps the row', async () => {
    pickSpotifyCandidates.mockResolvedValue([
      { artistId: 'art-1', status: 'taken', message: "This Spotify artist is already linked to 'Avello (NL)'. Use that artist, or ask an admin to merge them." },
    ]);
    await open([avello()]);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Avello for Avello' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("already linked to 'Avello (NL)'");
    expect(within(alert.closest('li')!).getByText('Avello Two')).toBeTruthy();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('a stale row takes the new version, so the next pick carries the new token', async () => {
    pickSpotifyCandidates
      .mockResolvedValueOnce([
        { artistId: 'art-1', status: 'changed', message: 'Someone changed Avello while you were editing.', artist: artist({ updatedAt: '2026-06-05T00:00:00.000Z' }) },
      ])
      .mockResolvedValueOnce([saved('art-1')]);
    await open([avello()]);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Avello for Avello' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Pick Avello for Avello' }));
    await waitFor(() => expect(pickSpotifyCandidates).toHaveBeenCalledTimes(2));
    expect((pickSpotifyCandidates.mock.calls[1]![1] as Array<{ expectedUpdatedAt: string }>)[0]!.expectedUpdatedAt).toBe('2026-06-05T00:00:00.000Z');
  });

  it('says so when Spotify did not answer for some artists, and offers another search', async () => {
    await open([avello()], { searchFailed: 2, notSearched: 3 });
    expect(screen.getByRole('status').textContent).toContain('Spotify did not answer for 2 artists');
    expect(screen.getByText(/3 more artists were not searched/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));
    await waitFor(() => expect(findSpotifyCandidates).toHaveBeenCalledTimes(2));
  });

  it('a search after None of these leaves that artist out, and so does an artist Spotify has no match for', async () => {
    const nobody = row({ id: 'art-9', name: 'Nobody' }, []);
    await open([avello(), hol(), nobody]);
    fireEvent.click(screen.getByRole('button', { name: 'None of these for Avello' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));
    await waitFor(() => expect(findSpotifyCandidates).toHaveBeenCalledTimes(2));
    expect(findSpotifyCandidates).toHaveBeenLastCalledWith('f1', expect.arrayContaining(['art-1', 'art-9']));
    expect((findSpotifyCandidates.mock.calls[1]![1] as string[]).includes('art-2')).toBe(false);
  });

  it('a stale row whose artist now has a Spotify link is removed, since a pick cannot replace a link', async () => {
    pickSpotifyCandidates.mockResolvedValue([
      {
        artistId: 'art-1',
        status: 'changed',
        message: 'Avello already has a Spotify link.',
        artist: artist({ updatedAt: '2026-06-05T00:00:00.000Z', links: { spotify: 'https://open.spotify.com/artist/abc' } }),
      },
    ]);
    await open([avello()]);
    fireEvent.click(screen.getByRole('button', { name: 'Pick Avello for Avello' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Pick Avello for Avello' })).toBeNull());
    expect(onApplied).toHaveBeenCalled();
  });

  it('shows a try again button when the search fails', async () => {
    findSpotifyCandidates.mockRejectedValue(new Error('down'));
    render(<SpotifyCandidates festivalId="f1" onApplied={onApplied} onClose={onClose} />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(toastError).toHaveBeenCalled();
  });
});
