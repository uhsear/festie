import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestQueryClient, renderWithQueryClient } from '../../test-utils';
import AdminArtistReview from './AdminArtistReview';

const toast = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError }) }));

const svc = vi.hoisted(() => ({ fetchArtistReview: vi.fn(), importArtistReview: vi.fn(), approveArtistReview: vi.fn(), rejectArtistReview: vi.fn() }));
vi.mock('@festie/shared/services/adminArtistReview', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchArtistReview: (...a: unknown[]) => svc.fetchArtistReview(...a),
  importArtistReview: (...a: unknown[]) => svc.importArtistReview(...a),
  approveArtistReview: (...a: unknown[]) => svc.approveArtistReview(...a),
  rejectArtistReview: (...a: unknown[]) => svc.rejectArtistReview(...a),
}));
vi.mock('@festie/shared/services/festivalAdmin', () => ({ fetchAdminFestivals: vi.fn() }));
vi.mock('@festie/shared/services/admin', async (orig) => ({ ...(await orig<Record<string, unknown>>()), fetchAdminCrews: vi.fn() }));
vi.mock('@festie/shared/services/organizer', () => ({ fetchManageFestivals: vi.fn(), fetchManageOrganization: vi.fn() }));
vi.mock('@festie/shared/services/adminOrganizations', () => ({ fetchOrganizations: vi.fn(), fetchOrganization: vi.fn(), fetchReviewQueue: vi.fn() }));
vi.mock('@festie/shared/services/adminArtistSuggestions', () => ({ fetchArtistSuggestions: vi.fn() }));

const SPOTIFY = 'https://open.spotify.com/artist/0d6aO1iQVWyxsN8UHfmHjm';
const item = (over: Record<string, unknown> = {}) => ({
  id: 'rev-1',
  kind: 'link',
  artistName: 'Galactic Effect',
  festival: 'cyclops-cove-2026',
  artistIds: [],
  candidates: [
    { spotifyUrl: SPOTIFY, otherUrls: ['https://linktr.ee/galacticeffect'], confidence: 'high', evidence: 'Own linktree points here <script>alert(1)</script>' },
    { spotifyUrl: 'https://open.spotify.com/artist/5wO8eYvh7c1oOKiWil29V1', otherUrls: [], confidence: 'low', evidence: 'Empty profile.' },
  ],
  proposed: { from: '', to: '' },
  note: 'Name differs on Spotify.',
  status: 'pending',
  chosenUrl: null,
  decisionNote: null,
  createdAt: '2026-11-21T12:00:00.000Z',
  decidedAt: null,
  festivalCount: null,
  ...over,
});

const render = () => renderWithQueryClient(<AdminArtistReview />, createTestQueryClient({ queries: { gcTime: 0, retry: false } }));

beforeEach(() => {
  vi.clearAllMocks();
  svc.fetchArtistReview.mockResolvedValue({ items: [item()], total: 1 });
  svc.importArtistReview.mockResolvedValue({ added: 2, skipped: 1, total: 3 });
  svc.approveArtistReview.mockResolvedValue({ status: 'approved', artistId: 'a1', festivalsUpdated: 2 });
  svc.rejectArtistReview.mockResolvedValue({ status: 'rejected' });
});

describe('AdminArtistReview', () => {
  it('lists the item with safe links, a confidence badge and evidence as plain text', async () => {
    const { container } = render();
    expect(await screen.findByText('Galactic Effect')).toBeInTheDocument();
    expect(screen.getByText('cyclops-cove-2026')).toBeInTheDocument();
    expect(screen.getByText('high confidence')).toBeInTheDocument();
    expect(screen.getByText('low confidence')).toBeInTheDocument();
    for (const href of [SPOTIFY, 'https://linktr.ee/galacticeffect']) {
      const link = screen.getByRole('link', { name: href });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
    expect(screen.getByText(/Own linktree points here <script>alert\(1\)<\/script>/)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(svc.fetchArtistReview).toHaveBeenCalledWith('pending', 25, 0);
  });

  it('approves the first candidate by default and the picked candidate when one is chosen', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Galactic Effect' }));
    await waitFor(() => expect(svc.approveArtistReview).toHaveBeenCalledWith('rev-1', { candidateIndex: 0 }));
    expect(toast).toHaveBeenCalledWith('Applied to Galactic Effect. 2 festivals updated.', 'success');

    await userEvent.click(screen.getByRole('radio', { name: 'Use candidate 2 for Galactic Effect' }));
    await userEvent.click(screen.getByRole('button', { name: 'Approve Galactic Effect' }));
    await waitFor(() => expect(svc.approveArtistReview).toHaveBeenLastCalledWith('rev-1', { candidateIndex: 1 }));
  });

  it('edits the link before approving and sends the typed link', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit link for Galactic Effect' }));
    const dialog = screen.getByRole('dialog');
    const field = within(dialog).getByRole('textbox');
    await userEvent.clear(field);
    await userEvent.type(field, 'https://open.spotify.com/artist/AAAAAAAAAAAAAAAAAAAAAA');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use this link' }));
    expect(await screen.findByText(/Your link:/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve Galactic Effect' }));
    await waitFor(() =>
      expect(svc.approveArtistReview).toHaveBeenCalledWith('rev-1', { candidateIndex: 0, url: 'https://open.spotify.com/artist/AAAAAAAAAAAAAAAAAAAAAA' }),
    );
  });

  it('cannot approve a link item that has no candidate until a link is typed', async () => {
    svc.fetchArtistReview.mockResolvedValue({ items: [item({ candidates: [] })], total: 1 });
    render();
    expect(await screen.findByText(/No candidate/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve Galactic Effect' })).toBeDisabled();
  });

  it('rejects with the optional note, and without one', async () => {
    render();
    const noteField = await screen.findByRole('textbox', { name: 'Reject note for Galactic Effect (optional)' });
    await userEvent.type(noteField, ' wrong act ');
    await userEvent.click(screen.getByRole('button', { name: 'Reject Galactic Effect' }));
    await waitFor(() => expect(svc.rejectArtistReview).toHaveBeenCalledWith('rev-1', 'wrong act'));
    await userEvent.clear(noteField);
    await userEvent.click(screen.getByRole('button', { name: 'Reject Galactic Effect' }));
    await waitFor(() => expect(svc.rejectArtistReview).toHaveBeenLastCalledWith('rev-1', undefined));
  });

  it('asks before a merge and sends the festival count the admin saw', async () => {
    svc.fetchArtistReview.mockResolvedValue({ items: [item({ kind: 'merge', artistName: 'YDG', festivalCount: 4 })], total: 1 });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve YDG' }));
    expect(svc.approveArtistReview).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/on 4 festivals, past ones too. It cannot be undone/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(svc.approveArtistReview).toHaveBeenCalledWith('rev-1', { candidateIndex: 0, acceptedFestivals: 4 }));
  });

  it('shows a rename as from and to, and approves it without a link', async () => {
    svc.fetchArtistReview.mockResolvedValue({
      items: [item({ kind: 'rename', artistName: 'MODAL NODES', candidates: [], proposed: { from: 'MODAL NODES', to: 'Modal Nodes' } })],
      total: 1,
    });
    render();
    expect(await screen.findByText('MODAL NODES -> Modal Nodes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit link/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Approve MODAL NODES' }));
    await waitFor(() => expect(svc.approveArtistReview).toHaveBeenCalledWith('rev-1', {}));
  });

  it('imports a pasted batch, reports the counts and reloads the queue', async () => {
    render();
    await screen.findByText('Galactic Effect');
    fireEvent.change(screen.getByRole('textbox', { name: 'Batch JSON' }), { target: { value: '{"generatedAt":"2026-11-21","items":[{"kind":"link"}]}' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(svc.importArtistReview).toHaveBeenCalledWith({ generatedAt: '2026-11-21', items: [{ kind: 'link' }] }));
    expect(toast).toHaveBeenCalledWith('Imported 2 new items, skipped 1 already in the queue.', 'success');
    await waitFor(() => expect(svc.fetchArtistReview.mock.calls.length).toBeGreaterThan(1));
  });

  it('refuses text that is not a batch before it reaches the server', async () => {
    render();
    await screen.findByText('Galactic Effect');
    fireEvent.change(screen.getByRole('textbox', { name: 'Batch JSON' }), { target: { value: '{nope' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid JSON');
    fireEvent.change(screen.getByRole('textbox', { name: 'Batch JSON' }), { target: { value: '{"items":[]}' } });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('"items" list');
    expect(svc.importArtistReview).not.toHaveBeenCalled();
  });

  it('pages through the queue', async () => {
    svc.fetchArtistReview.mockResolvedValue({ items: [item()], total: 40 });
    render();
    expect(await screen.findByText('1 to 1 of 40')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(svc.fetchArtistReview).toHaveBeenLastCalledWith('pending', 25, 25));
  });

  it('shows an empty state, and a retry when the queue does not load', async () => {
    svc.fetchArtistReview.mockResolvedValueOnce({ items: [], total: 0 });
    const { unmount } = render();
    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument();
    unmount();
    svc.fetchArtistReview.mockRejectedValueOnce(new Error('offline'));
    render();
    expect(await screen.findByText("Couldn't load the review queue")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('reports a failed decision and reloads the queue', async () => {
    svc.approveArtistReview.mockRejectedValue(new Error('409'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Approve Galactic Effect' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(svc.fetchArtistReview.mock.calls.length).toBeGreaterThan(1));
  });
});
