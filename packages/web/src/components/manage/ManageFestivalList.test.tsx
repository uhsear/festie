import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ManageFestival, ManageOrganization } from '@festie/shared/services/organizer';
import ManageFestivalList from './ManageFestivalList';

const toast = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError: vi.fn() }) }));

const festival = (over: Partial<ManageFestival>): ManageFestival => ({
  id: 'f1',
  name: 'Draft Fest',
  location: 'Orlando',
  organizationId: 'org-a',
  slug: null,
  published: false,
  deleted: false,
  publishRequestedAt: null,
  publishReviewNote: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...over,
});

const org = (over: Partial<ManageOrganization> = {}): ManageOrganization => ({
  id: 'org-a',
  name: 'Venue A',
  role: 'owner',
  status: 'active',
  verified: false,
  ...over,
});

const result = (over: Record<string, unknown>) =>
  ({ isPending: false, isError: false, data: [], refetch: vi.fn(), ...over }) as unknown as UseQueryResult<ManageFestival[]>;

const renderList = (data: ManageFestival[], organizations: ManageOrganization[], handlers = {}) => {
  const props = { onOpen: vi.fn(), onNew: vi.fn(), onDelete: vi.fn(), ...handlers };
  render(<ManageFestivalList query={result({ data })} organizations={organizations} {...props} />);
  return props;
};

describe('ManageFestivalList', () => {
  it('shows a status chip and the plain status text for each festival', () => {
    renderList(
      [
        festival({ id: 'a', name: 'Draft Fest' }),
        festival({ id: 'b', name: 'Waiting Fest', publishRequestedAt: '2026-11-02T12:00:00.000Z' }),
        festival({ id: 'c', name: 'Declined Fest', publishReviewNote: 'Add a stage.' }),
        festival({ id: 'd', name: 'Live Fest', published: true, slug: 'live-fest' }),
      ],
      [org()],
    );
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Waiting for review')).toBeInTheDocument();
    expect(screen.getByText('Changes requested')).toBeInTheDocument();
    expect(screen.getByText('Festie asked for changes: Add a stage.')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /\/f\/live-fest$/ })).toBeInTheDocument();
  });

  it('copies the public link of a live festival', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderList([festival({ published: true, slug: 'live-fest' })], [org()]);
    await userEvent.click(screen.getByRole('button', { name: 'Copy link to Draft Fest' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/f\/live-fest$/));
    expect(toast).toHaveBeenCalledWith('Link copied.', 'success');
  });

  it('offers Delete draft to an owner on a draft only', () => {
    renderList(
      [festival({ id: 'a', name: 'Draft Fest' }), festival({ id: 'b', name: 'Live Fest', published: true, slug: 's' })],
      [org()],
    );
    expect(screen.getByRole('button', { name: 'Delete Draft Fest' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Live Fest' })).not.toBeInTheDocument();
  });

  it('hides Delete and New festival from a viewer and an editor', () => {
    const { unmount } = render(
      <ManageFestivalList query={result({ data: [festival({})] })} organizations={[org({ role: 'viewer' })]} onOpen={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New festival' })).not.toBeInTheDocument();
    unmount();
    renderList([festival({})], [org({ role: 'editor' })]);
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
    // The server lets only an owner create (festival.create), so an editor is not offered the button.
    expect(screen.queryByRole('button', { name: 'New festival' })).not.toBeInTheDocument();
  });

  it('offers the sample import file to an editor but not to a viewer', () => {
    const { unmount } = render(
      <ManageFestivalList query={result({ data: [festival({})] })} organizations={[org({ role: 'viewer' })]} onOpen={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Download a sample import file' })).not.toBeInTheDocument();
    unmount();
    renderList([festival({})], [org({ role: 'editor' })]);
    expect(screen.getByRole('button', { name: 'Download a sample import file' })).toBeInTheDocument();
  });

  it('opens a festival and starts a new one', async () => {
    const { onOpen, onNew } = renderList([festival({})], [org()]);
    await userEvent.click(screen.getByRole('button', { name: 'Draft Fest' }));
    expect(onOpen).toHaveBeenCalledWith('f1');
    await userEvent.click(screen.getByRole('button', { name: 'New festival' }));
    expect(onNew).toHaveBeenCalled();
  });

  it('groups festivals by organization for a member of two', () => {
    renderList(
      [festival({ id: 'a', name: 'Alpha Fest' }), festival({ id: 'b', name: 'Beta Fest', organizationId: 'org-b' })],
      [org(), org({ id: 'org-b', name: 'Promoter B' })],
    );
    expect(within(screen.getByRole('region', { name: 'Venue A' })).getByText('Alpha Fest')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Promoter B' })).getByText('Beta Fest')).toBeInTheDocument();
  });

  it('hides festivals that were deleted', () => {
    renderList([festival({ name: 'Gone Fest', deleted: true })], [org()]);
    expect(screen.queryByText('Gone Fest')).not.toBeInTheDocument();
    expect(screen.getByText('No festivals yet')).toBeInTheDocument();
  });

  it('explains a pending and a suspended organization', () => {
    const { unmount } = render(
      <ManageFestivalList query={result({ data: [] })} organizations={[org({ status: 'pending' })]} onOpen={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Festie is checking your organization. You can build drafts now. Uploads and Submit unlock when we approve you.',
    );
    unmount();
    render(
      <ManageFestivalList query={result({ data: [] })} organizations={[org({ status: 'suspended' })]} onOpen={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent("Your organization's access is paused. Your live festivals stay visible to attendees.");
    expect(screen.getByRole('link', { name: 'Contact Festie' })).toHaveAttribute('href', 'mailto:support@festie.us');
    expect(screen.queryByRole('button', { name: 'New festival' })).not.toBeInTheDocument();
  });

  it('retries after a load error', async () => {
    const refetch = vi.fn();
    render(
      <ManageFestivalList
        query={result({ isError: true, error: new Error('offline'), refetch })}
        organizations={[org()]}
        onOpen={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });
});
