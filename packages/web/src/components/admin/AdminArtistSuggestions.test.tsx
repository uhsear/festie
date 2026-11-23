import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createTestQueryClient, renderWithQueryClient } from '../../test-utils';
import AdminArtistSuggestions from './AdminArtistSuggestions';

const toast = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError }) }));

const svc = vi.hoisted(() => ({ fetchArtistSuggestions: vi.fn(), decideArtistSuggestion: vi.fn() }));
vi.mock('@festie/shared/services/adminArtistSuggestions', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchArtistSuggestions: (...a: unknown[]) => svc.fetchArtistSuggestions(...a),
  decideArtistSuggestion: (...a: unknown[]) => svc.decideArtistSuggestion(...a),
}));
vi.mock('@festie/shared/services/festivalAdmin', () => ({ fetchAdminFestivals: vi.fn() }));
vi.mock('@festie/shared/services/admin', () => ({ fetchAdminCrews: vi.fn() }));
vi.mock('@festie/shared/services/organizer', () => ({ fetchManageFestivals: vi.fn() }));
vi.mock('@festie/shared/services/adminOrganizations', () => ({ fetchOrganizations: vi.fn(), fetchOrganization: vi.fn(), fetchReviewQueue: vi.fn() }));

const suggestion = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  status: 'pending',
  changes: { name: 'INFEKT Live', addLink: 'https://open.spotify.com/artist/abc' },
  note: null,
  createdAt: '2026-11-02T12:00:00.000Z',
  decidedAt: null,
  artist: { id: 'a1', name: 'INFEKT', label: 'UK', links: {}, mergedInto: null },
  organization: { id: 'o1', name: 'Venue A' },
  festival: null,
  createdBy: 'sam',
  festivalCount: 3,
  ...over,
});

const render = () => renderWithQueryClient(<AdminArtistSuggestions />, createTestQueryClient({ queries: { gcTime: 0, retry: false } }));

beforeEach(() => {
  vi.clearAllMocks();
  svc.fetchArtistSuggestions.mockResolvedValue([suggestion()]);
  svc.decideArtistSuggestion.mockResolvedValue({ status: 'accepted', artistId: 'a1', festivalsUpdated: 3 });
});

describe('AdminArtistSuggestions', () => {
  it('lists each suggestion with the author, the organization and one line per change', async () => {
    render();
    expect(await screen.findByText('INFEKT (UK)')).toBeInTheDocument();
    expect(screen.getByText(/Venue A, sent by sam/)).toBeInTheDocument();
    expect(screen.getByText(/on 3 festivals/)).toBeInTheDocument();
    expect(screen.getByText('Rename it to "INFEKT Live"')).toBeInTheDocument();
    expect(screen.getByText('Add the link https://open.spotify.com/artist/abc')).toBeInTheDocument();
    expect(svc.fetchArtistSuggestions).toHaveBeenCalledWith('pending');
  });

  it('accepts after a confirmation that names the festivals it changes', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the change to INFEKT (UK)' }));
    expect(screen.getByText(/It changes the artist on 3 festivals, past ones too/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(svc.decideArtistSuggestion).toHaveBeenCalledWith('s1', 'accept', undefined));
    expect(toast).toHaveBeenCalledWith('Applied to INFEKT (UK) and 3 festivals.', 'success');
  });

  it('does not say "0 festivals" when no festival copy needed updating', async () => {
    svc.decideArtistSuggestion.mockResolvedValue({ status: 'accepted', artistId: 'a1', festivalsUpdated: 0 });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the change to INFEKT (UK)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith('Applied to INFEKT (UK). No festival copies needed updating.', 'success'),
    );
  });

  it('rejects only with a note that the organization reads', async () => {
    svc.decideArtistSuggestion.mockResolvedValue({ status: 'rejected', artistId: 'a1', festivalsUpdated: 0 });
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Reject the change to INFEKT (UK)' }));
    const confirm = screen.getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Why is it rejected?'), ' Not the same artist. ');
    await userEvent.click(confirm);
    await waitFor(() => expect(svc.decideArtistSuggestion).toHaveBeenCalledWith('s1', 'reject', 'Not the same artist.'));
  });

  it('cannot accept a suggestion for a merged artist, and says so', async () => {
    svc.fetchArtistSuggestions.mockResolvedValue([suggestion({ artist: { id: 'a1', name: 'INFEKT', label: '', links: {}, mergedInto: 'a2' } })]);
    render();
    expect(await screen.findByText(/was merged into another one/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept the change to INFEKT' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject the change to INFEKT' })).toBeEnabled();
  });

  it('shows an empty state, and a retry when the list does not load', async () => {
    svc.fetchArtistSuggestions.mockResolvedValueOnce([]);
    const { unmount } = render();
    expect(await screen.findByText('No artist suggestions are waiting.')).toBeInTheDocument();
    unmount();
    svc.fetchArtistSuggestions.mockRejectedValueOnce(new Error('offline'));
    render();
    expect(await screen.findByText("Couldn't load the suggestions")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('reports a failed decision and reloads the list', async () => {
    svc.decideArtistSuggestion.mockRejectedValue(new Error('409'));
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the change to INFEKT (UK)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    await waitFor(() => expect(svc.fetchArtistSuggestions.mock.calls.length).toBeGreaterThan(1));
  });
});
