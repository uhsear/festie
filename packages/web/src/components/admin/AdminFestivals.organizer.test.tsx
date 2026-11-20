import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiClientError } from '@festie/shared/services/api';
import type { ManageOrganization } from '@festie/shared/services/organizer';
import { createTestQueryClient, renderWithQueryClient } from '../../test-utils';
import AdminFestivals from './AdminFestivals';

const toast = vi.fn();
const setSearch = vi.fn();
let search: Record<string, string> = {};
const routes: string[] = [];

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));
vi.mock('./useAdminSearch', () => ({
  useAdminSearch: (route: string) => {
    routes.push(route);
    return [search, setSearch];
  },
}));
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast, toastError: vi.fn() }),
}));
vi.mock('../../hooks/useReauthPrompt', () => ({
  useReauthPrompt: () => ({ askPassword: vi.fn(), reauthDialog: null }),
}));
vi.mock('../../hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({ confirmLeave: (fn: () => void) => fn(), guardDialog: null }),
}));
vi.mock('./LineupImport', () => ({ default: ({ scope }: { scope: string }) => <p>import scope {scope}</p> }));
vi.mock('./FestivalMapEditor', () => ({ default: ({ scope }: { scope: string }) => <p>map scope {scope}</p> }));
vi.mock('./FestivalAnnouncements', () => ({ default: () => <p>announcements panel</p> }));
vi.mock('./AdminFestivalPreview', () => ({ default: ({ scope }: { scope: string }) => <p>preview scope {scope}</p> }));
vi.mock('./FestivalStatusPanel', () => ({
  default: ({ organizer }: { organizer?: { role: string; verified: boolean } }) => (
    <p data-testid="status-panel">{organizer ? `organizer ${organizer.role} verified=${organizer.verified}` : 'admin'}</p>
  ),
}));
vi.mock('./FestivalEditForm', () => ({
  default: ({
    onSave,
    setFormData,
    formData,
    mode,
    readOnly,
  }: {
    onSave: () => void;
    setFormData: (f: unknown) => void;
    formData: { name?: string; timeZone?: string };
    mode: string;
    readOnly: boolean;
  }) => (
    <div>
      <span data-testid="form-mode">
        {mode} readOnly={String(readOnly)} zone={formData.timeZone ?? 'none'} name={formData.name ?? ''}
      </span>
      <button onClick={() => setFormData({ ...formData, name: 'Typed name', location: 'Typed place', timeZone: 'UTC' })}>fill form</button>
      <button onClick={onSave}>save form</button>
    </div>
  ),
}));

const mockGet = vi.fn();
const mockPut = vi.fn();
const mockPost = vi.fn();
vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    get: (...a: unknown[]) => mockGet(...a),
    put: (...a: unknown[]) => mockPut(...a),
    post: (...a: unknown[]) => mockPost(...a),
    delete: vi.fn(),
  },
}));

const org = (over: Partial<ManageOrganization> = {}): ManageOrganization => ({
  id: 'org-a',
  name: 'Venue A',
  role: 'owner',
  status: 'active',
  verified: false,
  ...over,
});

const FULL = {
  id: 'f1',
  name: 'Fest',
  location: 'Here',
  timeZone: 'UTC',
  organizationId: 'org-a',
  updatedAt: '2026-10-01T00:00:00.000Z',
  stages: [],
  days: [],
  publishedAt: null,
  checklist: [],
};

const render = (organizations: ManageOrganization[]) =>
  renderWithQueryClient(
    <AdminFestivals mode="organizer" organizations={organizations} />,
    createTestQueryClient({ queries: { gcTime: 0, retry: false } }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  routes.length = 0;
  search = { festival: 'f1', view: 'edit' };
  mockGet.mockImplementation(async (path: string) => {
    if (path === '/manage/festivals') {
      return [
        { id: 'f1', name: 'Fest', location: 'Here', organizationId: 'org-a', slug: null, published: false, deleted: false, publishRequestedAt: null, publishReviewNote: null, updatedAt: FULL.updatedAt },
      ];
    }
    return FULL;
  });
});

describe('AdminFestivals in organizer mode', () => {
  it('reads and saves through /manage and keeps the admin-only panels out', async () => {
    mockPut.mockResolvedValue(undefined);
    render([org()]);
    await userEvent.click(await screen.findByRole('button', { name: 'save form' }));
    // An organizer who saves nothing yet has nothing to save, so the form's own gate is not needed here:
    // the save path still runs because the mocked form calls onSave directly.
    await waitFor(() => expect(mockPut).toHaveBeenCalled());
    expect(mockGet).toHaveBeenCalledWith('/manage/festivals/f1');
    expect(mockGet).not.toHaveBeenCalledWith(expect.stringContaining('/admin/'));
    expect(mockPut.mock.calls[0][0]).toBe('/manage/festivals/f1');
    // The server holds an organizer's alert, but only when the save asks to notify.
    expect(mockPut.mock.calls[0][1]).toMatchObject({ notify: true, expectedUpdatedAt: FULL.updatedAt });
    expect(routes.every((r) => r === '/manage')).toBe(true);
    expect(screen.queryByText('announcements panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-mode')).toHaveTextContent('organizer readOnly=false');
    expect(screen.getByTestId('status-panel')).toHaveTextContent('organizer owner verified=false');
  });

  it('keeps the form and shows who saved first on a 409, then reloads on request', async () => {
    mockPut.mockRejectedValueOnce(
      new ApiClientError('changed', 409, 'FESTIVAL_CHANGED', undefined, undefined, {
        updatedBy: 'Sam at Venue A',
        updatedAt: '2026-10-02T15:30:00.000Z',
      }),
    );
    render([org({ role: 'editor' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'fill form' }));
    await userEvent.click(screen.getByRole('button', { name: 'save form' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Sam at Venue A saved this festival');
    expect(alert).toHaveTextContent('Your changes are still in the form. Reload, then make your change again.');
    // The typed values are still in the form.
    expect(screen.getByTestId('form-mode')).toHaveTextContent('name=Typed name');
    const loads = mockGet.mock.calls.filter(([p]) => p === '/manage/festivals/f1').length;
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect(mockGet.mock.calls.filter(([p]) => p === '/manage/festivals/f1').length).toBeGreaterThan(loads),
    );
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('tells an editor that an owner must confirm a removal, and keeps the edits', async () => {
    mockPut.mockRejectedValue(
      new ApiClientError('removes sets', 409, 'CONFIRM_REMOVALS', undefined, undefined, {
        removal: { days: 0, sets: 3, picks: 12, ratings: 0 },
      }),
    );
    render([org({ role: 'editor' })]);
    await userEvent.click(await screen.findByRole('button', { name: 'fill form' }));
    await userEvent.click(screen.getByRole('button', { name: 'save form' }));
    expect(await screen.findByText('Attendees already picked these sets. An owner of Venue A must confirm the removal.')).toBeInTheDocument();
    expect(screen.queryByText('Remove sets with picks?')).not.toBeInTheDocument();
    expect(screen.getByTestId('form-mode')).toHaveTextContent('name=Typed name');
  });

  it('opens the confirm dialog for an owner on CONFIRM_REMOVALS', async () => {
    mockPut.mockRejectedValueOnce(
      new ApiClientError('removes sets', 409, 'CONFIRM_REMOVALS', undefined, undefined, {
        removal: { days: 0, sets: 3, picks: 12, ratings: 0 },
      }),
    );
    mockPut.mockResolvedValueOnce(undefined);
    render([org()]);
    await userEvent.click(await screen.findByRole('button', { name: 'save form' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Remove and save' }));
    await waitFor(() => expect(mockPut).toHaveBeenCalledTimes(2));
    expect(mockPut.mock.calls[1][0]).toBe('/manage/festivals/f1');
    expect(mockPut.mock.calls[1][1]).toMatchObject({ confirmRemovals: true });
  });

  it('shows a viewer the details only, read-only', async () => {
    search = { festival: 'f1', view: 'import' };
    render([org({ role: 'viewer' })]);
    expect(await screen.findByTestId('form-mode')).toHaveTextContent('organizer readOnly=true');
    expect(screen.queryByText(/import scope/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Map' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import lineup' })).not.toBeInTheDocument();
    expect(screen.getByText(/You can look at this festival but not change it/)).toBeInTheDocument();
  });

  it('passes the organizer scope to the map and import views for an editor', async () => {
    search = { festival: 'f1', view: 'map' };
    const first = render([org({ role: 'editor' })]);
    expect(await screen.findByText('map scope manage')).toBeInTheDocument();
    first.unmount();
    search = { festival: 'f1', view: 'import' };
    render([org({ role: 'editor' })]);
    expect(await screen.findByText('import scope manage')).toBeInTheDocument();
  });

  it('reads a suspended organization as read-only with the contact line', async () => {
    render([org({ status: 'suspended' })]);
    expect(await screen.findByTestId('form-mode')).toHaveTextContent('readOnly=true');
    expect(screen.getByRole('alert')).toHaveTextContent("Your organization's access is paused. Your live festivals stay visible to attendees.");
  });

  it('says the festival is not available when the server answers 404', async () => {
    mockGet.mockRejectedValue(new ApiClientError('Not found', 404, 'NOT_FOUND'));
    render([org()]);
    expect(
      await screen.findByText('This festival is not available to your account. You may have been removed from its team.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Back to my festivals' }).length).toBeGreaterThan(0);
  });

  it('creates a draft in the chosen organization with the browser time zone', async () => {
    search = { view: 'edit' };
    mockPost.mockResolvedValue({ id: 'new1' });
    render([org(), org({ id: 'org-b', name: 'Promoter B' })]);
    expect(await screen.findByTestId('form-mode')).toHaveTextContent(/zone=\S+/);
    expect(screen.getByTestId('form-mode')).not.toHaveTextContent('zone=none');
    await userEvent.selectOptions(screen.getByLabelText('Organization'), 'org-b');
    await userEvent.click(screen.getByRole('button', { name: 'fill form' }));
    await userEvent.click(screen.getByRole('button', { name: 'save form' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalled());
    expect(mockPost.mock.calls[0][0]).toBe('/manage/festivals');
    expect(mockPost.mock.calls[0][1]).toMatchObject({ name: 'Typed name', organizationId: 'org-b' });
    expect(toast).toHaveBeenCalledWith('Festival created as a draft. Only your team and Festie can see it.', 'success');
  });

  it('lists the festivals of the organizations from /manage/festivals', async () => {
    search = {};
    render([org()]);
    expect(await screen.findByRole('button', { name: 'Fest' })).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/manage/festivals');
    expect(mockGet).not.toHaveBeenCalledWith('/admin/festivals');
    await userEvent.click(screen.getByRole('button', { name: 'Fest' }));
    expect(setSearch).toHaveBeenCalledWith({ festival: 'f1' });
  });
});
