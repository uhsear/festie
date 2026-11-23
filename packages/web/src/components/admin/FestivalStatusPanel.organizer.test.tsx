import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FestivalStatusPanel, { type OrganizerPanelContext } from './FestivalStatusPanel';

const publishFestival = vi.fn();
const submitForReview = vi.fn();
const withdrawReview = vi.fn();
const checklistFromError = vi.fn();
vi.mock('@festie/shared/services/festivalAdmin', () => ({
  publishFestival: (...a: unknown[]) => publishFestival(...a),
  checklistFromError: (...a: unknown[]) => checklistFromError(...a),
}));
vi.mock('@festie/shared/services/organizer', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  submitForReview: (...a: unknown[]) => submitForReview(...a),
  withdrawReview: (...a: unknown[]) => withdrawReview(...a),
}));
const toast = vi.fn();
const toastError = vi.fn();
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast, toastError }) }));

const done = [{ key: 'timeZone', status: 'done', label: 'Time zone: UTC' }] as const;
const names = [
  { key: 'days', status: 'todo', label: 'Add a day.' },
  { key: 'sets', status: 'todo', label: 'Add sets.' },
] as const;

const ctx = (over: Partial<OrganizerPanelContext> = {}): OrganizerPanelContext => ({
  role: 'owner',
  orgName: 'Venue A',
  orgStatus: 'active',
  verified: false,
  ...over,
});

const renderPanel = (
  organizer: OrganizerPanelContext,
  meta: React.ComponentProps<typeof FestivalStatusPanel>['meta'] = { publishedAt: null, checklist: [...done] },
  over: Partial<React.ComponentProps<typeof FestivalStatusPanel>> = {},
) =>
  render(
    <FestivalStatusPanel
      festivalId="f1"
      name="Fest"
      meta={meta}
      dirty={false}
      onPublished={vi.fn()}
      onImport={vi.fn()}
      onEditMap={vi.fn()}
      organizer={organizer}
      {...over}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  checklistFromError.mockReturnValue(null);
});

describe('FestivalStatusPanel in organizer mode', () => {
  it('gives an owner of an unverified organization Submit for review instead of Publish', async () => {
    submitForReview.mockResolvedValue({ requestedAt: 'x', checklist: [] });
    const onPublished = vi.fn();
    renderPanel(ctx(), undefined, { onPublished });
    expect(screen.queryByRole('button', { name: 'Publish festival' })).not.toBeInTheDocument();
    expect(screen.getByText('Only your team and Festie can see it.')).toBeInTheDocument();
    expect(screen.getByText('Before you submit')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    expect(screen.getByText('Submit Fest for review?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(submitForReview).toHaveBeenCalledWith('f1'));
    expect(toast).toHaveBeenCalledWith('Sent. Festie usually reviews within 2 working days. We will email you.', 'success');
    expect(onPublished).toHaveBeenCalled();
    expect(publishFestival).not.toHaveBeenCalled();
  });

  it('lets a names-only festival go to review: the days and sets items do not block Submit', () => {
    renderPanel(ctx(), { publishedAt: null, checklist: [...done, ...names] });
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  });

  it('still blocks Submit on another open item, and while the form has unsaved edits', () => {
    const { unmount } = renderPanel(ctx(), {
      publishedAt: null,
      checklist: [{ key: 'timeZone', status: 'todo', label: "Choose the festival's time zone." }],
    });
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    unmount();
    renderPanel(ctx(), undefined, { dirty: true });
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    expect(screen.getByText('Save your changes first.')).toBeInTheDocument();
  });

  it('keeps the server checklist when the submit is refused', async () => {
    const fresh = [{ key: 'location', status: 'todo', label: 'Add the venue.' }];
    submitForReview.mockRejectedValue(new Error('Finish the checklist before you submit.'));
    checklistFromError.mockReturnValue(fresh);
    renderPanel(ctx());
    await userEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('Add the venue.')).toBeInTheDocument();
    expect(toastError).toHaveBeenCalled();
  });

  it('shows an editor and a viewer the status chip only', () => {
    for (const role of ['editor', 'viewer'] as const) {
      const { unmount } = renderPanel(ctx({ role }));
      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Submit|Publish|Withdraw/ })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('gives a viewer the checklist without the shortcuts into the editors', () => {
    const checklist = [
      { key: 'sets', status: 'todo', label: 'Add sets.' },
      { key: 'pins', status: 'warn', label: '1 stage has no pin.' },
    ] as const;
    const { unmount } = renderPanel(ctx({ role: 'viewer' }), { publishedAt: null, checklist: [...checklist] });
    expect(screen.getByText('Add sets.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import lineup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit map' })).not.toBeInTheDocument();
    unmount();
    renderPanel(ctx({ role: 'editor' }), { publishedAt: null, checklist: [...checklist] });
    expect(screen.getByRole('button', { name: 'Import lineup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit map' })).toBeInTheDocument();
  });

  it('shows Waiting for review with Withdraw for an owner only', async () => {
    withdrawReview.mockResolvedValue({ withdrawn: true });
    const meta = { publishedAt: null, publishRequestedAt: '2026-11-02T12:00:00.000Z', checklist: [...done] };
    const { unmount } = renderPanel(ctx({ role: 'editor' }), meta);
    expect(screen.getAllByText(/Waiting for review/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Withdraw request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
    unmount();
    const onPublished = vi.fn();
    renderPanel(ctx(), meta, { onPublished });
    expect(screen.getByText('Festie usually reviews within 2 working days. We will email you.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(withdrawReview).toHaveBeenCalledWith('f1'));
    expect(onPublished).toHaveBeenCalled();
  });

  it('shows the decline note and offers Submit again', () => {
    renderPanel(ctx(), { publishedAt: null, publishReviewNote: 'Add the stage map.', checklist: [...done] });
    expect(screen.getByText('Changes requested')).toBeInTheDocument();
    expect(screen.getByText('Festie asked for changes: Add the stage map.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit again' })).toBeEnabled();
  });

  it('shows the public link with Copy once the festival is live', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel(ctx(), { publishedAt: '2026-11-03T00:00:00.000Z', slug: 'fest-2026', checklist: [...done] });
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /\/f\/fest-2026$/ })).toBeInTheDocument();
    expect(screen.queryByText('Before you submit')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/f\/fest-2026$/));
    expect(toast).toHaveBeenCalledWith('Link copied.', 'success');
  });

  it('lets an owner of a verified organization publish through the organizer route', async () => {
    publishFestival.mockResolvedValue({ publishedAt: 'x', checklist: [] });
    renderPanel(ctx({ verified: true }));
    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publish festival' }));
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(publishFestival).toHaveBeenCalledWith('f1', 'manage'));
    expect(submitForReview).not.toHaveBeenCalled();
  });

  it('keeps Submit locked while the organization is pending', () => {
    renderPanel(ctx({ orgStatus: 'pending' }));
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    expect(screen.getByText('Festie is checking your organization. Submit unlocks when we approve you.')).toBeInTheDocument();
  });

  it('says access is paused, not pending, for a suspended organization', () => {
    renderPanel(ctx({ orgStatus: 'suspended' }));
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
    expect(screen.getByText("Your organization's access is paused. Contact Festie.")).toBeInTheDocument();
    expect(screen.queryByText(/checking your organization/)).not.toBeInTheDocument();
  });
});
