import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ManageFestival, ManageOrganization } from '@festie/shared/services/organizer';
import ManageFestivalList from './ManageFestivalList';
import FestivalStatusPanel from '../admin/FestivalStatusPanel';
import FestivalEditForm from '../admin/FestivalEditForm';

vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn(), toastError: vi.fn() }) }));
vi.mock('@festie/shared/services/timeReleases', () => ({ timeReleaseApi: { panel: vi.fn().mockResolvedValue(null), send: vi.fn() } }));

const organizations: ManageOrganization[] = [
  { id: 'a', name: 'Venue A', role: 'owner', status: 'active', verified: false },
  { id: 'b', name: 'Promoter B', role: 'viewer', status: 'pending', verified: false },
];
const base = { location: 'Orlando', slug: null, published: false, deleted: false, publishRequestedAt: null, publishReviewNote: null, updatedAt: '2026-11-01T00:00:00.000Z' };
const festivals: ManageFestival[] = [
  { ...base, id: '1', name: 'Draft Fest', organizationId: 'a' },
  { ...base, id: '2', name: 'Waiting Fest', organizationId: 'a', publishRequestedAt: '2026-11-02T12:00:00.000Z' },
  { ...base, id: '3', name: 'Declined Fest', organizationId: 'b', publishReviewNote: 'Add the map.' },
  { ...base, id: '4', name: 'Live Fest', organizationId: 'b', published: true, slug: 'live-fest' },
];

describe('organizer screens: accessibility', () => {
  it('the festival list has no structural violations', async () => {
    const query = { isPending: false, isError: false, data: festivals, refetch: vi.fn() } as unknown as UseQueryResult<ManageFestival[]>;
    const { container } = render(
      <ManageFestivalList query={query} organizations={organizations} onOpen={vi.fn()} onNew={vi.fn()} onDelete={vi.fn()} />,
    );
    await expect(container).toBeAccessible();
  });

  it('the status panel has none in draft, review and live states', async () => {
    const organizer = { role: 'owner' as const, orgName: 'Venue A', orgStatus: 'active' as const, verified: false };
    const checklist = [{ key: 'timeZone', status: 'todo' as const, label: 'Choose a time zone.' }];
    const metas = [
      { publishedAt: null, checklist },
      { publishedAt: null, publishRequestedAt: '2026-11-02T12:00:00.000Z', checklist },
      { publishedAt: '2026-11-03T00:00:00.000Z', slug: 'live-fest', checklist },
    ];
    for (const meta of metas) {
      const { container, unmount } = render(
        <FestivalStatusPanel festivalId="f1" name="Fest" meta={meta} dirty={false} onPublished={vi.fn()} onImport={vi.fn()} onEditMap={vi.fn()} organizer={organizer} />,
      );
      await expect(container).toBeAccessible();
      unmount();
    }
  });

  it('the organizer form has none, editable or read-only', async () => {
    const props = {
      editingId: 'f1',
      notifyPickers: true,
      onNotifyPickersChange: vi.fn(),
      changes: { total: 0, changedSetIds: new Set<string>(), newSetIds: new Set<string>() },
      issues: [],
      saving: false,
      formData: { name: 'Fest', location: 'Here', timeZone: 'UTC', stages: [{ id: 's1', name: 'Main', color: '#fff' }], days: [] },
      setFormData: vi.fn(),
      onSave: vi.fn(),
      onDiscard: vi.fn(),
      onCancel: vi.fn(),
      mode: 'organizer' as const,
    };
    for (const readOnly of [false, true]) {
      const { container, unmount } = render(<FestivalEditForm {...props} readOnly={readOnly} />);
      await expect(container).toBeAccessible();
      unmount();
    }
  });
});
