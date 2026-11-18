import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastError = vi.fn();
const listFestivalArtists = vi.fn();
const searchArtists = vi.fn();
const updateArtist = vi.fn();
const findSpotifyCandidates = vi.fn();

vi.mock('@festie/shared/services', async (orig) => ({
  ...(await orig<typeof import('@festie/shared/services')>()),
  listFestivalArtists: (...a: unknown[]) => listFestivalArtists(...a),
  searchArtists: (...a: unknown[]) => searchArtists(...a),
  updateArtist: (...a: unknown[]) => updateArtist(...a),
  findSpotifyCandidates: (...a: unknown[]) => findSpotifyCandidates(...a),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError }) }));

import { ApiClientError } from '@festie/shared/services/api';
import FestivalArtists from './FestivalArtists';

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

const rows = () => [
  artist(),
  artist({ id: 'art-2', name: 'Cyclops', links: { spotify: 'https://open.spotify.com/artist/x' }, linkCount: 1, alsoOn: 2 }),
];

async function open() {
  render(<FestivalArtists festivalId="f1" festivalName="Fest" onClose={() => {}} />);
  await screen.findByText('Avello');
}

describe('FestivalArtists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listFestivalArtists.mockResolvedValue(rows());
    searchArtists.mockResolvedValue([]);
  });

  it('lists this festival\'s artists with link platforms and where else they play', async () => {
    await open();
    expect(listFestivalArtists).toHaveBeenCalledWith('f1');
    expect(screen.getByText('1 of 2 artists have a link.')).toBeTruthy();
    expect(screen.getAllByText('No links')).toHaveLength(2);
    expect(screen.getByText(/Spotify · Also on 2 festivals/)).toBeTruthy();
  });

  it('expands a row in place and saves that row on its own', async () => {
    updateArtist.mockResolvedValue({ artist: artist({ links: { soundcloud: 'https://soundcloud.com/avello' }, updatedAt: '2026-06-02T00:00:00.000Z' }), festivalsUpdated: 1 });
    await open();
    expect(screen.queryByLabelText('Add link for Avello')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Avello, edit' }));
    fireEvent.change(screen.getByLabelText('Add link for Avello'), { target: { value: 'https://soundcloud.com/avello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Avello' }));
    await waitFor(() =>
      expect(updateArtist).toHaveBeenCalledWith('art-1', '2026-06-01T00:00:00.000Z', { addLink: 'https://soundcloud.com/avello' }),
    );
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(updateArtist).toHaveBeenCalledTimes(1);
  });

  it('asks "Change everywhere?" once, only for an artist on other festivals', async () => {
    updateArtist.mockResolvedValue({ artist: artist({ id: 'art-2', name: 'Cyclops', alsoOn: 2, links: {}, linkCount: 0 }), festivalsUpdated: 3 });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Cyclops, edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Spotify link for Cyclops' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Cyclops' }));
    expect(await screen.findByText('Cyclops is also on 2 festivals, including past ones. Change it everywhere?')).toBeTruthy();
    expect(updateArtist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Change everywhere'));
    await waitFor(() => expect(updateArtist).toHaveBeenCalledWith('art-2', '2026-06-01T00:00:00.000Z', { removeLinks: ['spotify'] }));

    // The second save of the same row does not ask again.
    updateArtist.mockResolvedValueOnce({ artist: artist({ id: 'art-2', name: 'Cyclops', alsoOn: 2 }), festivalsUpdated: 3 });
    fireEvent.change(await screen.findByLabelText('Add link for Cyclops'), { target: { value: 'https://x.com/cyclops' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Cyclops' }));
    await waitFor(() => expect(updateArtist).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(/Change it everywhere/)).toBeNull();
  });

  it('a conflict keeps the row open, shows the new version and the message', async () => {
    updateArtist.mockRejectedValue(
      new ApiClientError('changed', 409, 'ARTIST_CHANGED', undefined, false, {
        artist: artist({ name: 'Avello', label: 'NL', updatedAt: '2026-06-03T00:00:00.000Z' }),
      }),
    );
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Avello, edit' }));
    fireEvent.change(screen.getByLabelText('Add link for Avello'), { target: { value: 'https://x.com/avello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Avello' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Someone changed Avello while you were editing. Here is the new version. Apply your change again.',
    );
    expect(screen.getByLabelText('Add link for Avello')).toBeTruthy();
    expect(screen.getByText('(NL)')).toBeTruthy();
  });

  it('shows the server message when a save is refused', async () => {
    updateArtist.mockRejectedValue(new ApiClientError('This is a Spotify track link. Open the artist page and copy that link.', 400, 'INVALID_INPUT'));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Avello, edit' }));
    fireEvent.change(screen.getByLabelText('Add link for Avello'), { target: { value: 'https://open.spotify.com/track/1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Avello' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Spotify track link');
  });

  it('the No links filter hides artists that have a link', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'No links' }));
    expect(screen.queryByText('Cyclops')).toBeNull();
  });

  it('Find missing links is gone, and Find Spotify links opens the picker without linking anything', async () => {
    findSpotifyCandidates.mockResolvedValue({ artists: [], notSearched: 0, searchFailed: 0 });
    await open();
    expect(screen.queryByText('Find missing links')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Find Spotify links' }));
    await waitFor(() => expect(findSpotifyCandidates).toHaveBeenCalledWith('f1'));
    expect(await screen.findByRole('region', { name: 'Find Spotify links' })).toBeTruthy();
    expect(updateArtist).not.toHaveBeenCalled();
  });

  it('renames an artist through the Name field and shows a refused name on the row', async () => {
    updateArtist.mockRejectedValueOnce(new ApiClientError('Avello Two already exists. Pick that artist, or use a different note.', 409, 'ARTIST_EXISTS'));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Avello, edit' }));
    fireEvent.change(screen.getByLabelText('Name for Avello'), { target: { value: 'Avello Two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Avello' }));
    await waitFor(() => expect(updateArtist).toHaveBeenCalledWith('art-1', '2026-06-01T00:00:00.000Z', { name: 'Avello Two' }));
    expect((await screen.findByRole('alert')).textContent).toContain('already exists');

    updateArtist.mockResolvedValueOnce({ artist: artist({ name: 'Avello Two', updatedAt: '2026-06-02T00:00:00.000Z' }), festivalsUpdated: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Save Avello' }));
    expect(await screen.findByText('Avello Two')).toBeTruthy();
  });

  it('the All artists search keeps its input mounted and focused, waits for the typing to stop, and drops a late reply', async () => {
    let releaseFirst: (rows: unknown[]) => void = () => {};
    searchArtists.mockImplementationOnce(() => new Promise((resolve) => (releaseFirst = resolve)));
    searchArtists.mockResolvedValue([artist({ id: 'art-9', name: 'Newest Match' })]);
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'All artists' }));
    const input = await screen.findByLabelText('Search artists');
    await userEvent.type(input, 'ne');
    expect(screen.getByLabelText('Search artists')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect((input as HTMLInputElement).value).toBe('ne');
    expect(await screen.findByText('Newest Match')).toBeTruthy();
    expect(searchArtists).toHaveBeenCalledWith('ne');
    expect(searchArtists).not.toHaveBeenCalledWith('n');

    releaseFirst([artist({ id: 'art-8', name: 'Stale Match' })]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Stale Match')).toBeNull();
    expect(screen.getByText('Newest Match')).toBeTruthy();
  });
});
