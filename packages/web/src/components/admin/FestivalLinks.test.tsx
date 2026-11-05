import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const toast = vi.fn();
const get = vi.fn();
const saveSetLink = vi.fn();
const runSpotifyBackfill = vi.fn();

vi.mock('@festie/shared/services/api', () => ({ api: { get: (...a: unknown[]) => get(...a) } }));
vi.mock('@festie/shared/services', () => ({
  saveSetLink: (...a: unknown[]) => saveSetLink(...a),
  runSpotifyBackfill: (...a: unknown[]) => runSpotifyBackfill(...a),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError: vi.fn() }) }));

import FestivalLinks from './FestivalLinks';

const festival = {
  stages: [{ id: 'st1', name: 'Main' }],
  days: [
    {
      id: 'd1',
      label: 'Friday',
      sets: [
        {
          id: 's1',
          artist: 'A b2b B',
          stageId: 'st1',
          artists: [
            { name: 'A', links: { spotify: 'https://open.spotify.com/artist/a' } },
            { name: 'B', links: {} },
          ],
        },
        { id: 's2', artist: 'C', stageId: 'st1', linkUrl: null },
      ],
    },
  ],
};

async function renderPanel() {
  render(<FestivalLinks festivalId="f1" festivalName="Fest" onClose={() => {}} />);
  await screen.findByLabelText('Spotify link for B');
}

describe('FestivalLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue(festival);
  });

  it('loads from the admin route so a draft festival opens', async () => {
    await renderPanel();
    expect(get).toHaveBeenCalledWith('/admin/festivals/f1');
  });

  it('renders one input per artist', async () => {
    await renderPanel();
    expect(screen.getByLabelText('Spotify link for A')).toBeTruthy();
    expect(screen.getByLabelText('Spotify link for C')).toBeTruthy();
    expect(screen.getByText('1 of 3 artists have a Spotify link.')).toBeTruthy();
  });

  it('saves artist 2 with index 1', async () => {
    saveSetLink.mockResolvedValue({ setId: 's1', artistIndex: 1, linkUrl: 'https://open.spotify.com/artist/b' });
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Spotify link for B'), {
      target: { value: 'https://open.spotify.com/artist/b' },
    });
    fireEvent.click(screen.getAllByText('Save link')[1]);
    await waitFor(() =>
      expect(saveSetLink).toHaveBeenCalledWith('f1', 's1', 'https://open.spotify.com/artist/b', 1),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith('Link saved.', 'success'));
  });

  it('rejects a non-https value without calling the API', async () => {
    await renderPanel();
    fireEvent.change(screen.getByLabelText('Spotify link for B'), { target: { value: 'http://x.com' } });
    fireEvent.click(screen.getAllByText('Save link')[1]);
    expect(await screen.findByText('Paste a link that starts with https://')).toBeTruthy();
    expect(saveSetLink).not.toHaveBeenCalled();
  });

  it('confirming backfill shows the summary and names', async () => {
    runSpotifyBackfill.mockResolvedValue({ updated: 1, skipped: 0, total: 2, unmatched: ['B'] });
    await renderPanel();
    fireEvent.click(screen.getByText('Find missing links'));
    fireEvent.click(await screen.findByText('Search Spotify'));
    await waitFor(() => expect(runSpotifyBackfill).toHaveBeenCalledWith('f1'));
    expect(await screen.findByText('Linked 1 of 2 sets. No match for 1 artist:')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('B');
  });

  it('Search again targets one set with force', async () => {
    runSpotifyBackfill.mockResolvedValue({ updated: 0, skipped: 0, total: 1, unmatched: ['C'] });
    await renderPanel();
    fireEvent.click(screen.getAllByText('Search again')[1]);
    await waitFor(() => expect(runSpotifyBackfill).toHaveBeenCalledWith('f1', { setIds: ['s2'], force: true }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith('No Spotify match for C.', 'info'));
  });
});
