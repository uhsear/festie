import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const state: Record<string, unknown> = {};
vi.mock('@festie/shared/stores', () => ({
  useFestivalStore: vi.fn((sel: (s: Record<string, unknown>) => unknown) => sel(state)),
}));
vi.mock('../ui/Avatar', () => ({ default: ({ name }: { name: string }) => <span data-testid="avatar">{name}</span> }));

import CrewHeader from './CrewHeader';

const crew = { id: 'c1', name: 'Squad', festivalId: 'f1' } as never;
const makeMembers = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, name: `Member ${i}` }));

describe('CrewHeader', () => {
  beforeEach(() => {
    state.festivals = [{ id: 'f1', name: 'Forbidden Kingdom' }];
    state.currentFestival = { id: 'f1', name: 'Forbidden Kingdom' };
  });

  it('renders the name, festival and member count', () => {
    render(<CrewHeader crew={crew} members={makeMembers(9)} onOpenMembers={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Squad' })).toBeInTheDocument();
    expect(screen.getByText(/Forbidden Kingdom · 9 members/)).toBeInTheDocument();
  });

  it('shows 5 avatars and +2 for 7 members', () => {
    render(<CrewHeader crew={crew} members={makeMembers(7)} onOpenMembers={vi.fn()} />);
    expect(screen.getAllByTestId('avatar')).toHaveLength(5);
    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('calls onOpenMembers on click', () => {
    const open = vi.fn();
    render(<CrewHeader crew={crew} members={makeMembers(3)} onOpenMembers={open} />);
    fireEvent.click(screen.getByRole('button', { name: 'See all 3 members' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('leaves out the festival when the name is null', () => {
    state.festivals = [];
    state.currentFestival = null;
    render(<CrewHeader crew={crew} members={makeMembers(1)} onOpenMembers={vi.fn()} />);
    expect(screen.getByText('1 member')).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });
});
