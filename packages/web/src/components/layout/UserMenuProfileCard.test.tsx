import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@festie/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared')>()),
  useFestivalStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ currentFestival: null, currentProfile: null }),
}));

import UserMenuProfileCard from './UserMenuProfileCard';

describe('UserMenuProfileCard', () => {
  it('shows the display name and @handle, not the filler line', () => {
    render(<UserMenuProfileCard user={{ name: 'Asir K', username: 'asir' }} />);
    expect(screen.getByText('Asir K')).toBeInTheDocument();
    expect(screen.getByText('@asir')).toBeInTheDocument();
    expect(screen.queryByText('Account identity across every festival')).toBeNull();
  });
});
