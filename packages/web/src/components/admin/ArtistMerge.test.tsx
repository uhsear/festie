import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const searchArtists = vi.fn();
const getArtistUse = vi.fn();
const mergeArtists = vi.fn();
const askPassword = vi.fn();

vi.mock('@festie/shared/services', async (orig) => ({
  ...(await orig<typeof import('@festie/shared/services')>()),
  searchArtists: (...a: unknown[]) => searchArtists(...a),
  getArtistUse: (...a: unknown[]) => getArtistUse(...a),
  mergeArtists: (...a: unknown[]) => mergeArtists(...a),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError: vi.fn() }) }));
vi.mock('../../hooks/useReauthPrompt', () => ({ useReauthPrompt: () => ({ askPassword, reauthDialog: null }) }));

import { ApiClientError } from '@festie/shared/services/api';
import ArtistMerge from './ArtistMerge';

const artist = (over: Record<string, unknown> = {}) => ({
  id: 'art-1',
  name: 'Sumthin Sumthin',
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
const festival = (id: string) => ({ id, name: id, published: true, archived: false, firstDate: null });
const use = (festivals: string[], sets: number, lineupEntries = 0) => ({ festivals: festivals.map(festival), counts: { sets, lineupEntries } });

const mine = artist({ links: { instagram: 'https://www.instagram.com/mine' } });
const theirs = artist({ id: 'art-2', name: "Sumthin' Sumthin'", updatedAt: '2026-06-02T00:00:00.000Z', links: { instagram: 'https://www.instagram.com/theirs' }, linkCount: 1 });

async function openPair(onMerged = vi.fn(), onClose = vi.fn()) {
  render(<ArtistMerge artist={mine as never} onMerged={onMerged} onClose={onClose} />);
  fireEvent.click(await screen.findByRole('button', { name: "Merge with Sumthin' Sumthin'" }));
  await screen.findByText(/This cannot be undone/);
  return { onMerged, onClose };
}

describe('ArtistMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchArtists.mockResolvedValue([mine, theirs]);
    getArtistUse.mockImplementation(async (id: string) => (id === 'art-1' ? use(['f1', 'f2'], 2) : use(['f2', 'f3', 'f4'], 3, 1)));
    mergeArtists.mockResolvedValue({ artist: mine, loserId: 'art-2', counts: { festivals: 4, sets: 3, lineupEntries: 1 } });
  });

  it('searches by the artist name, leaves the artist itself out of the results, and previews the move', async () => {
    await openPair();
    expect(searchArtists).toHaveBeenCalledWith('Sumthin Sumthin');
    expect(screen.queryByRole('button', { name: 'Merge with Sumthin Sumthin' })).toBeNull();
    // The other artist has more appearances, so it survives by default and this artist moves.
    expect(screen.getByText("Moves 2 appearances on 2 festivals from 'Sumthin Sumthin' to 'Sumthin' Sumthin''. This cannot be undone. To split them later, re-pick the artist on each set.")).toBeTruthy();
  });

  it('sends the survivor, the loser, the festival count the editor saw and the picks', async () => {
    const { onMerged, onClose } = await openPair();
    // Keep this artist's Instagram link even though the other artist survives.
    fireEvent.click(screen.getByLabelText('Instagram link: https://www.instagram.com/mine'));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(mergeArtists).toHaveBeenCalledTimes(1));
    const [survivor, loser, options] = mergeArtists.mock.calls[0] as [{ id: string }, { id: string }, { pick: unknown; acceptedFestivals: number }];
    expect(survivor.id).toBe('art-2');
    expect(loser.id).toBe('art-1');
    // f1, f2, f3, f4: the festival both artists play counts once.
    expect(options.acceptedFestivals).toBe(4);
    expect(options.pick).toEqual({ links: { instagram: 'loser' } });
    await waitFor(() => expect(onMerged).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith('Merged.', 'success');
    expect(onClose).toHaveBeenCalled();
  });

  it('lets the editor switch the survivor, and a name pick follows the artist, not the position', async () => {
    await openPair();
    fireEvent.click(screen.getByLabelText(/Sumthin Sumthin \(2 appearances\)/));
    fireEvent.click(screen.getByLabelText("Name: Sumthin' Sumthin'"));
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(mergeArtists).toHaveBeenCalledTimes(1));
    const [survivor, , options] = mergeArtists.mock.calls[0] as [{ id: string }, unknown, { pick: unknown }];
    expect(survivor.id).toBe('art-1');
    expect(options.pick).toEqual({ name: 'loser' });
  });

  it('shows the server message when the merge is refused, and does not close', async () => {
    mergeArtists.mockRejectedValue(new ApiClientError("Both artists play together in 'A b2b B'. They cannot be the same artist.", 409, 'INVALID_INPUT'));
    const { onMerged, onClose } = await openPair();
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Both artists play together');
    expect(onMerged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('on ARTIST_CHANGED it asks the list to reload and starts the pair again', async () => {
    mergeArtists.mockRejectedValue(new ApiClientError('Someone changed one of these artists. Reload the pair.', 409, 'ARTIST_CHANGED'));
    const onStale = vi.fn();
    const onMerged = vi.fn();
    render(<ArtistMerge artist={mine as never} onMerged={onMerged} onStale={onStale} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: "Merge with Sumthin' Sumthin'" }));
    await screen.findByText(/This cannot be undone/);
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
    expect(onMerged).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: "Merge with Sumthin' Sumthin'" })).toBeTruthy();
    expect((screen.getByRole('alert')).textContent).toContain('Reload the pair');
  });

  it('lists the suggested partners first, even when the name search misses them', async () => {
    searchArtists.mockResolvedValue([]);
    const partner = artist({ id: 'art-9', name: 'Sumthin Sumthim' });
    render(<ArtistMerge artist={mine as never} suggested={[partner as never]} onMerged={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Merge with Sumthin Sumthim' })).toBeTruthy();
  });

  it('asks for the password when the server wants a recent check, and a cancel merges nothing', async () => {
    mergeArtists.mockRejectedValue(new ApiClientError('Confirm your password to continue.', 403, 'REAUTH_REQUIRED'));
    askPassword.mockResolvedValue(null);
    const { onMerged } = await openPair();
    fireEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(askPassword).toHaveBeenCalled());
    expect(mergeArtists).toHaveBeenCalledTimes(1);
    expect(onMerged).not.toHaveBeenCalled();
  });
});
