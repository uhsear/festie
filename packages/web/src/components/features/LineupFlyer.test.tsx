import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DISCOVER_COPY } from '@festie/shared/constants';

const auth = { user: null as { id: string } | null };
const festivalState = { currentFestival: { id: 'f1', name: 'Alpha' }, currentProfile: null };

vi.mock('@festie/shared/stores', () => ({
  useAuthStore: (sel: (s: typeof auth) => unknown) => sel(auth),
  useFestivalStore: (sel: (s: typeof festivalState) => unknown) => sel(festivalState),
  useFollowStore: (sel: (s: { festivalIds: string[] }) => unknown) => sel({ festivalIds: [] }),
}));
vi.mock('./FollowButton', () => ({ default: () => <button type="button">Follow</button> }));
vi.mock('../brand/BrandWordmark', () => ({ default: () => <span>FESTIE</span> }));

import LineupFlyer from './LineupFlyer';

const model = {
  rows: [
    { key: '1', name: 'Alice', size: 'headliner' as const },
    { key: '2', name: 'Bob', size: 'support' as const },
    { key: '3', name: 'Carol', size: 'rest' as const },
  ],
};

describe('LineupFlyer', () => {
  it('lists the acts in billing order with one Follow button and no priority controls', () => {
    auth.user = { id: 'u1' };
    render(<LineupFlyer model={model} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Alice', 'Bob', 'Carol']);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /must|want|maybe/i })).not.toBeInTheDocument();
    expect(screen.queryByText(DISCOVER_COPY.flyer.guestLine)).not.toBeInTheDocument();
  });

  it('adds the lockup and one sentence for a signed-out visitor', () => {
    auth.user = null;
    render(<LineupFlyer model={model} />);
    expect(screen.getByText(DISCOVER_COPY.flyer.guestLine)).toBeInTheDocument();
    expect(screen.getByText('FESTIE')).toBeInTheDocument();
  });
});
