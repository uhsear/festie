import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { encodePlanSnapshot } from '@festie/shared/utils';

const apiGet = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@festie/shared/services', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args) },
}));

import PlanSnapshotPage from './plan-snapshot';

const festival = {
  id: 'fest-1',
  name: 'Live Fest',
  stages: [{ id: 'st-1', name: 'Main Stage' }],
  days: [
    {
      id: 'd1',
      date: '2026-07-10',
      label: 'Friday',
      sets: [{ id: 'set-1', stageId: 'st-1', startTime: '21:30', endTime: '22:30', artist: 'Aurora' }],
    },
  ],
};

function setHash(hash: string) {
  window.location.hash = hash;
}

function snapshotHash(picks: Array<{ setId: string; priority: 'must' | 'want' | 'maybe' }>, withMeet = false) {
  return encodePlanSnapshot({
    festivalId: 'fest-1',
    festivalName: 'Snap Fest',
    picks,
    ...(withMeet ? { meetingPoint: { label: 'North gate', lat: 1.5, lng: 2.5 } } : {}),
  });
}

describe('PlanSnapshotPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    setHash('');
  });

  it('orders days by the festival and rows by start time, not by priority', async () => {
    apiGet.mockResolvedValue({
      ...festival,
      days: [
        { id: 'd1', date: '2026-07-10', label: 'Friday', sets: [
          { id: 'a', stageId: 'st-1', startTime: '22:00', artist: 'Late' },
          { id: 'b', stageId: 'st-1', startTime: '18:00', artist: 'Early' },
        ] },
        { id: 'd2', date: '2026-07-11', label: 'Saturday', sets: [{ id: 'c', stageId: 'st-1', startTime: '20:00', artist: 'Sat' }] },
      ],
    });
    setHash(snapshotHash([
      { setId: 'c', priority: 'must' },
      { setId: 'a', priority: 'want' },
      { setId: 'b', priority: 'maybe' },
    ]));
    render(<PlanSnapshotPage />);
    await screen.findByText('Early');
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Friday', 'Saturday']);
    const text = document.body.textContent ?? '';
    expect(text.indexOf('Early')).toBeLessThan(text.indexOf('Late'));
  });

  it('renders picks by day from the festival, with the meeting point link', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(snapshotHash([{ setId: 'set-1', priority: 'must' }], true));
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('Aurora')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live Fest' })).toBeInTheDocument();
    expect(screen.getByText('Friday')).toBeInTheDocument();
    expect(screen.getByText(/Main Stage/)).toHaveTextContent('Must See');
    expect(screen.getByRole('link', { name: 'Meet at North gate' })).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=1.5,2.5',
    );
    expect(apiGet).toHaveBeenCalledWith('/festivals/fest-1');
  });

  it.each(['', 'garbage!!', 'a'.repeat(5000)])('shows the unreadable state for hash %#', (hash) => {
    setHash(hash);
    render(<PlanSnapshotPage />);
    expect(screen.getByText("This plan code can't be read")).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('shows the snapshot name, count and offline line when the fetch fails', async () => {
    apiGet.mockRejectedValue(new Error('offline'));
    setHash(snapshotHash([{ setId: 'set-1', priority: 'want' }]));
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('Connect to the internet to see set names and times.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Snap Fest' })).toBeInTheDocument();
    expect(screen.getByText(/1 set$/)).toBeInTheDocument();
  });

  it('counts picks missing from the lineup', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(
      snapshotHash([
        { setId: 'set-1', priority: 'must' },
        { setId: 'gone-1', priority: 'maybe' },
        { setId: 'gone-2', priority: 'maybe' },
      ]),
    );
    render(<PlanSnapshotPage />);
    await waitFor(() => expect(screen.getByText('2 picks are no longer in the lineup.')).toBeInTheDocument());
  });

  it('renders the Plan B line from a v2 code', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(
      encodePlanSnapshot({
        festivalId: 'fest-1',
        festivalName: 'Snap Fest',
        picks: [{ setId: 'set-1', priority: 'must' }],
        planB: 'Top of the hour',
      }),
    );
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('If we lose each other: Top of the hour')).toBeInTheDocument();
  });

  it('renders a v1 code without a Plan B line', async () => {
    apiGet.mockResolvedValue(festival);
    setHash(snapshotHash([{ setId: 'set-1', priority: 'must' }]));
    render(<PlanSnapshotPage />);
    expect(await screen.findByText('Aurora')).toBeInTheDocument();
    expect(screen.queryByText(/If we lose each other/)).toBeNull();
  });
});
