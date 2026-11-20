import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./api', () => ({ api }));

import {
  canEditOrgFestival,
  createManageFestival,
  describeStaleSave,
  fetchManageFestivals,
  fetchManageMe,
  isOrgOwner,
  organizerFestivalStatus,
  organizerPublicLink,
  submitForReview,
  withdrawReview,
} from './organizer';

beforeEach(() => vi.clearAllMocks());

describe('organizer API paths', () => {
  it('reads /manage and never an admin path', async () => {
    await fetchManageMe();
    await fetchManageFestivals();
    expect(api.get).toHaveBeenNthCalledWith(1, '/manage/me');
    expect(api.get).toHaveBeenNthCalledWith(2, '/manage/festivals');
  });

  it('creates, submits and withdraws through /manage with the id encoded', async () => {
    await createManageFestival({ name: 'Fest', organizationId: 'org-a' });
    await submitForReview('a b/1');
    await withdrawReview('a b/1');
    expect(api.post).toHaveBeenNthCalledWith(1, '/manage/festivals', { name: 'Fest', organizationId: 'org-a' });
    expect(api.post).toHaveBeenNthCalledWith(2, '/manage/festivals/a%20b%2F1/publish-request');
    expect(api.delete).toHaveBeenCalledWith('/manage/festivals/a%20b%2F1/publish-request');
  });
});

describe('organizerFestivalStatus', () => {
  it('is a draft with no request and no note', () => {
    expect(organizerFestivalStatus({})).toEqual({
      state: 'draft',
      chip: 'Draft',
      text: 'Only your team and Festie can see it.',
    });
  });

  it('waits for review while a request is open, even with an old note', () => {
    const s = organizerFestivalStatus({ publishRequestedAt: '2026-11-02T12:00:00.000Z', publishReviewNote: 'old' });
    expect(s.state).toBe('review');
    expect(s.chip).toBe('Waiting for review');
    expect(s.text).toMatch(/^Waiting for review\. Sent /);
  });

  it('shows the decline note when the request was cleared', () => {
    expect(organizerFestivalStatus({ publishReviewNote: 'Add the map.' })).toEqual({
      state: 'changes',
      chip: 'Changes requested',
      text: 'Festie asked for changes: Add the map.',
    });
  });

  it('is live once published, and names the public address', () => {
    const s = organizerFestivalStatus({ published: true, slug: 'fest-2026', publishReviewNote: 'old' }, 'https://festie.us');
    expect(s).toEqual({ state: 'live', chip: 'Live', text: 'Live at festie.us/f/fest-2026.' });
    expect(organizerFestivalStatus({ publishedAt: '2026-11-03T00:00:00.000Z' }).text).toBe('Live.');
  });
});

describe('organizerPublicLink', () => {
  it('builds the page link from the slug and returns null without one', () => {
    expect(organizerPublicLink('fest-2026', 'https://festie.us')).toBe('https://festie.us/f/fest-2026');
    expect(organizerPublicLink(null)).toBeNull();
  });
});

describe('describeStaleSave', () => {
  it('names the first editor and the time', () => {
    const text = describeStaleSave({ updatedBy: 'Sam at Venue A', updatedAt: '2026-11-02T15:30:00.000Z' });
    expect(text).toMatch(/^Sam at Venue A saved this festival at /);
    expect(text).toMatch(/Your changes are still in the form\. Reload, then make your change again\.$/);
  });

  it('falls back to Someone when the server sent no details', () => {
    expect(describeStaleSave(undefined)).toBe(
      'Someone saved this festival. Your changes are still in the form. Reload, then make your change again.',
    );
  });
});

describe('role helpers', () => {
  it('lets owners and editors edit, and only owners do owner actions', () => {
    expect(isOrgOwner('owner')).toBe(true);
    expect(isOrgOwner('editor')).toBe(false);
    expect(canEditOrgFestival('editor')).toBe(true);
    expect(canEditOrgFestival('viewer')).toBe(false);
    expect(canEditOrgFestival(null)).toBe(false);
  });
});
