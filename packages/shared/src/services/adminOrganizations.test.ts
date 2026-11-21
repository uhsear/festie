import { describe, it, expect, vi, beforeEach } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./api', () => ({ api }));

import {
  addOrganizationMember,
  createOrganization,
  declinePublishRequest,
  discardHeldAlerts,
  fetchReviewQueue,
  handBackFestival,
  releaseHeldAlerts,
  removeOrganizationMember,
  removePendingMember,
  setOrganizationStatus,
  setOrganizationVerified,
  transferFestival,
} from './adminOrganizations';
import { fetchAdminFestival, publishFestival, updateAdminFestival } from './festivalAdmin';
import { lineupImportApi } from './lineupImport';

beforeEach(() => vi.clearAllMocks());

describe('admin organization paths', () => {
  it('calls the organization routes with encoded ids and the right verbs', async () => {
    await createOrganization({ name: 'Venue', kind: 'venue' });
    await setOrganizationStatus('o 1', 'suspended');
    await setOrganizationVerified('o 1', true);
    await addOrganizationMember('o 1', { email: 'a@b.example', role: 'owner' });
    await removeOrganizationMember('o 1', 'u/1');
    await removePendingMember('o 1', 'a@b.example');
    await setOrganizationStatus('o 1', 'suspended', 'Chargeback dispute');
    await transferFestival('o 1', 'f/1');
    await handBackFestival('o 1', 'f/1');
    expect(api.put).toHaveBeenCalledWith('/admin/organizations/o%201/status', { status: 'suspended', reason: 'Chargeback dispute' });
    expect(api.post).toHaveBeenCalledWith('/admin/organizations/o%201/festivals', { festivalId: 'f/1' });
    expect(api.delete).toHaveBeenCalledWith('/admin/organizations/o%201/festivals/f%2F1');
    expect(api.post).toHaveBeenCalledWith('/admin/organizations', { name: 'Venue', kind: 'venue' });
    expect(api.put).toHaveBeenCalledWith('/admin/organizations/o%201/status', { status: 'suspended' });
    expect(api.put).toHaveBeenCalledWith('/admin/organizations/o%201/verified', { verified: true });
    expect(api.post).toHaveBeenCalledWith('/admin/organizations/o%201/members', { email: 'a@b.example', role: 'owner' });
    expect(api.delete).toHaveBeenCalledWith('/admin/organizations/o%201/members/u%2F1');
    expect(api.delete).toHaveBeenCalledWith('/admin/organizations/o%201/pending-members/a%40b.example');
  });

  it('calls the queue, held alert and decline routes', async () => {
    await fetchReviewQueue();
    await releaseHeldAlerts('f 1');
    await discardHeldAlerts('f 1');
    await declinePublishRequest('f 1', 'Add the map.');
    expect(api.get).toHaveBeenCalledWith('/admin/organizations/review-queue');
    expect(api.post).toHaveBeenCalledWith('/admin/organizations/held-alerts/f%201/release');
    expect(api.delete).toHaveBeenCalledWith('/admin/organizations/held-alerts/f%201');
    expect(api.post).toHaveBeenCalledWith('/admin/festivals/f%201/publish/decline', { note: 'Add the map.' });
  });
});

describe('festival scope', () => {
  it('keeps the admin paths by default and uses /manage for an organizer', async () => {
    await fetchAdminFestival('f1');
    await fetchAdminFestival('f1', 'manage');
    await updateAdminFestival('f1', { name: 'x' });
    await updateAdminFestival('f1', { name: 'x' }, 'manage');
    await publishFestival('f1', 'manage');
    await lineupImportApi.preview('f1', { rows: [] } as never);
    await lineupImportApi.commit('f1', { rows: [] } as never, 'manage');
    await lineupImportApi.history('f1', 'manage');
    await lineupImportApi.undo('f1', 'i1', 'manage');
    expect(api.get).toHaveBeenCalledWith('/admin/festivals/f1');
    expect(api.get).toHaveBeenCalledWith('/manage/festivals/f1');
    expect(api.put).toHaveBeenCalledWith('/admin/festivals/f1', { name: 'x' });
    expect(api.put).toHaveBeenCalledWith('/manage/festivals/f1', { name: 'x' });
    expect(api.post).toHaveBeenCalledWith('/manage/festivals/f1/publish');
    expect(api.post).toHaveBeenCalledWith('/admin/festivals/f1/import-lineup/preview', { rows: [] });
    expect(api.post).toHaveBeenCalledWith('/manage/festivals/f1/import-lineup', { rows: [] }, { timeoutMs: 120_000 });
    expect(api.get).toHaveBeenCalledWith('/manage/festivals/f1/imports');
    expect(api.post).toHaveBeenCalledWith('/manage/festivals/f1/imports/i1/undo');
  });
});
