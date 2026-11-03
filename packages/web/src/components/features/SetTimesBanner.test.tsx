import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    follow.festivalIds = [];
    Object.assign(festivalState, {
      currentFestival: { id: 'f1', name: 'Alpha' },
      sets: [
        { id: 's1', startTime: null },
        { id: 's2', startTime: '' },
      ],
      currentProfile: null,
    });
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

  it('hides when the festival has no sets', () => {
    festivalState.sets = [];
    const { container } = render(<SetTimesBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
