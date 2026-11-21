import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { createTestQueryClient, renderWithQueryClient } from '../../test-utils';
import ManageActivity, { describeAction } from './ManageActivity';
import ManageInterest from './ManageInterest';

const mockGet = vi.fn();
vi.mock('@festie/shared/services/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => mockGet(...a) },
}));

const render = (node: React.ReactElement) => renderWithQueryClient(node, createTestQueryClient({ queries: { gcTime: 0, retry: false } }));

beforeEach(() => vi.clearAllMocks());

describe('ManageActivity', () => {
  it('names the actor and the action, and reads the organization audit route', async () => {
    mockGet.mockResolvedValue([
      { id: 'a1', action: 'festival.publish_requested', targetType: 'festival', targetId: 'f1', createdAt: '2026-11-02T10:00:00.000Z', actor: 'Alex at Venue A', details: {} },
      { id: 'a2', action: 'festival.published', targetType: 'festival', targetId: 'f1', createdAt: '2026-11-03T10:00:00.000Z', actor: 'Festie support', details: null },
    ]);
    render(<ManageActivity organizationId="org-a" />);
    expect(await screen.findByText('Festival publish requested')).toBeInTheDocument();
    expect(screen.getByText(/Alex at Venue A/)).toBeInTheDocument();
    expect(screen.getByText(/Festie support/)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/manage/organizations/org-a/audit');
  });

  it('says so when nothing happened, and offers Retry on a failure', async () => {
    mockGet.mockResolvedValueOnce([]);
    const { unmount } = render(<ManageActivity organizationId="org-a" />);
    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument();
    unmount();
    mockGet.mockRejectedValueOnce(new Error('boom'));
    render(<ManageActivity organizationId="org-a" />);
    expect(await screen.findByText("Couldn't load the activity")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('turns an action key into a sentence', () => {
    expect(describeAction('organization.member_added')).toBe('Organization member added');
  });
});

describe('ManageInterest', () => {
  const days = [{ sets: [{ id: 's1', artist: 'DJ One' }, { id: 's2', artist: 'DJ Two' }] }];

  it('explains the floor while too few people joined, and shows no counts', async () => {
    mockGet.mockResolvedValue({ available: false, minJoined: 20, minCount: 5, sets: {} });
    render(<ManageInterest festivalId="f1" days={days} />);
    expect(await screen.findByText(/Counts show once 20 people have joined/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(mockGet).toHaveBeenCalledWith('/manage/festivals/f1/engagement');
  });

  it('shows counts by artist, and "fewer than 5" for a hidden one', async () => {
    mockGet.mockResolvedValue({
      available: true,
      minJoined: 20,
      minCount: 5,
      sets: { s1: { picks: 12, reminders: null }, s2: { picks: null, reminders: null }, gone: { picks: 6, reminders: 6 } },
    });
    render(<ManageInterest festivalId="f1" days={days} />);
    expect(await screen.findByText('DJ One')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getAllByText('fewer than 5')).toHaveLength(3);
    expect(screen.getByText('gone')).toBeInTheDocument();
  });
});
