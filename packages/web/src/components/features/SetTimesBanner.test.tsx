import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const festivalState: Record<string, unknown> = {};
const follow = { festivalIds: [] as string[] };

vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) => sel(festivalState),
  useFollowStore: (sel: (s: typeof follow) => unknown) => sel(follow),
}));
vi.mock('./FollowButton', () => ({ default: () => <button>Follow</button> }));

import SetTimesBanner from './SetTimesBanner';

describe('SetTimesBanner', () => {
  beforeEach(() => {
    // Pin the clock before the fixture's day so the festival never reads as finished.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2027, 0, 1));
    follow.festivalIds = [];
    Object.assign(festivalState, {
      currentFestival: { id: 'f1', name: 'Alpha' },
      days: [{ date: '2027-02-05' }],
      sets: [
        { id: 's1', startTime: null },
        { id: 's2', startTime: '' },
      ],
      currentProfile: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('guest: shows the title and a Follow button', () => {
    render(<SetTimesBanner />);
    expect(screen.getByRole('heading', { name: 'Set times are not out yet' })).toBeInTheDocument();
    expect(screen.getByText('Follow to hear when they are.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });

  it('has a profile: promises a notification and no button', () => {
    festivalState.currentProfile = { id: 'p1' };
    render(<SetTimesBanner />);
    expect(screen.getByText("We'll tell you when they are.")).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('follows: promises a notification and no button', () => {
    follow.festivalIds = ['f1'];
    render(<SetTimesBanner />);
    expect(screen.getByText("We'll tell you when they are.")).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides once any set has a time', () => {
    festivalState.sets = [
      { id: 's1', startTime: null },
      { id: 's2', startTime: '22:00' },
    ];
    const { container } = render(<SetTimesBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('no sets and no act with a day: names days as well as set times', () => {
    festivalState.sets = [];
    festivalState.currentFestival = { id: 'f1', name: 'Alpha', lineup: [{ id: 'a1', status: 'announced', dayDate: null }] };
    render(<SetTimesBanner />);
    expect(screen.getByRole('heading', { name: 'Days and set times are not out yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument();
  });

  it('no sets but an act has a day: keeps today\'s set-times copy', () => {
    festivalState.sets = [];
    festivalState.currentFestival = { id: 'f1', name: 'Alpha', lineup: [{ id: 'a1', status: 'announced', dayDate: '2027-02-05' }] };
    render(<SetTimesBanner />);
    expect(screen.getByRole('heading', { name: 'Set times are not out yet' })).toBeInTheDocument();
  });

  it('sets with no times keep today\'s copy', () => {
    render(<SetTimesBanner />);
    expect(screen.queryByText('Days and set times are not out yet')).toBeNull();
  });

  it('hides for a draft', () => {
    festivalState.sets = [];
    festivalState.currentFestival = { id: 'f1', name: 'Alpha', publishedAt: null };
    const { container } = render(<SetTimesBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
