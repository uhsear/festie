import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./api', () => ({ api }));

import {
  addManageMember,
  canEditOrgFestival,
  changeManageMemberRole,
  clearEditBackup,
  describeAlertConfirm,
  describeEngagementCount,
  describeUpload,
  fetchManageActivity,
  fetchManageEngagement,
  editBackupKey,
  fetchManageOrganization,
  loadEditBackup,
  removeManageInvitation,
  removeManageMember,
  saveEditBackup,
  updateManageOrganization,
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

describe('organization API paths', () => {
  it('reads and writes the organization, its members and its invitations under /manage with ids encoded', async () => {
    await fetchManageOrganization('org a');
    await updateManageOrganization('org a', { displayName: null });
    await addManageMember('org a', { email: 'a@b.example', role: 'editor' });
    await changeManageMemberRole('org a', 'u/1', 'viewer');
    await removeManageMember('org a', 'u/1');
    await removeManageInvitation('org a', 'a+b@c.example');
    expect(api.get).toHaveBeenCalledWith('/manage/organizations/org%20a');
    expect(api.put).toHaveBeenNthCalledWith(1, '/manage/organizations/org%20a', { displayName: null });
    expect(api.post).toHaveBeenCalledWith('/manage/organizations/org%20a/members', { email: 'a@b.example', role: 'editor' });
    expect(api.put).toHaveBeenNthCalledWith(2, '/manage/organizations/org%20a/members/u%2F1', { role: 'viewer' });
    expect(api.delete).toHaveBeenNthCalledWith(1, '/manage/organizations/org%20a/members/u%2F1');
    expect(api.delete).toHaveBeenNthCalledWith(2, '/manage/organizations/org%20a/pending-members/a%2Bb%40c.example');
  });
});

describe('describeUpload', () => {
  it('shows megabytes used against the cap', () => {
    expect(describeUpload({ usedBytes: 0, capBytes: 200 * 1024 * 1024 })).toBe('0 MB of 200 MB used for site-plan images.');
    expect(describeUpload({ usedBytes: 12.34 * 1024 * 1024, capBytes: 200 * 1024 * 1024 })).toBe('12.3 MB of 200 MB used for site-plan images.');
  });
});

describe('edit backup (two editors at once)', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };

  it('keeps the form per festival, returns it after a reload and clears it', () => {
    const storage = memory();
    expect(saveEditBackup(storage, 'f1', { name: 'Mine' }, new Date('2026-11-20T10:00:00Z'))).toBe(true);
    expect(loadEditBackup(storage, 'f2')).toBeNull();
    expect(loadEditBackup(storage, 'f1')).toEqual({ savedAt: '2026-11-20T10:00:00.000Z', form: { name: 'Mine' } });
    clearEditBackup(storage, 'f1');
    expect(loadEditBackup(storage, 'f1')).toBeNull();
  });

  it('survives blocked or full storage and a damaged entry', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(saveEditBackup(blocked, 'f1', {})).toBe(false);
    expect(loadEditBackup(blocked, 'f1')).toBeNull();
    expect(() => clearEditBackup(blocked, 'f1')).not.toThrow();
    const storage = memory();
    storage.setItem(editBackupKey('f1'), '{not json');
    expect(loadEditBackup(storage, 'f1')).toBeNull();
    storage.setItem(editBackupKey('f1'), JSON.stringify({ savedAt: 'x', form: 'text' }));
    expect(loadEditBackup(storage, 'f1')).toBeNull();
  });
});

describe('the trust tier calls and wording', () => {
  it('reads the organization activity, with a cursor when there is one', async () => {
    api.get.mockResolvedValue([]);
    await fetchManageActivity('org a');
    expect(api.get).toHaveBeenCalledWith('/manage/organizations/org%20a/audit');
    await fetchManageActivity('org-a', 'c1|x');
    expect(api.get).toHaveBeenCalledWith('/manage/organizations/org-a/audit?cursor=c1%7Cx');
  });

  it('reads the interest counts of one festival', async () => {
    api.get.mockResolvedValue({ available: false, minJoined: 20, minCount: 5, sets: {} });
    await fetchManageEngagement('f 1');
    expect(api.get).toHaveBeenCalledWith('/manage/festivals/f%201/engagement');
  });

  it('writes a hidden count as "fewer than 5" and a shown one as the number', () => {
    expect(describeEngagementCount(null)).toBe('fewer than 5');
    expect(describeEngagementCount(null, 10)).toBe('fewer than 10');
    expect(describeEngagementCount(0)).toBe('0');
    expect(describeEngagementCount(12)).toBe('12');
  });

  it('words the confirm for one person and for many, and says when the hour is used up', () => {
    expect(describeAlertConfirm(1)).toBe('This save tells 1 person that a set they picked moved or was removed.');
    expect(describeAlertConfirm(40, 2)).toBe('This save tells 40 people that a set they picked moved or was removed.');
    expect(describeAlertConfirm(40, 0)).toContain('used its alerts for this hour');
    expect(describeAlertConfirm(undefined)).toBe('This save tells a small group of people that a set they picked moved or was removed.');
  });
});
