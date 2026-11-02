import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSetPublicSchedule = vi.fn();
let storeUser: Record<string, unknown>;

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: storeUser, setPublicSchedule: (...a: unknown[]) => mockSetPublicSchedule(...a) }),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('lucide-react', () => ({ Globe: () => <span /> }));

import PublicScheduleSection from './PublicScheduleSection';

describe('PublicScheduleSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeUser = { id: 'u1', username: 'raver' };
    mockSetPublicSchedule.mockResolvedValue(undefined);
  });

  it('is off by default and hides the link', () => {
    render(<PublicScheduleSection />);
    expect(screen.getByRole('switch', { name: 'Public schedule page' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('public-schedule-url')).toBeNull();
  });

  it('turning it on saves the flag', async () => {
    render(<PublicScheduleSection />);
    await userEvent.click(screen.getByRole('switch'));
    expect(mockSetPublicSchedule).toHaveBeenCalledWith(true);
  });

  it('shows the link and copy button when on', () => {
    storeUser = { id: 'u1', username: 'raver', publicSchedule: true };
    render(<PublicScheduleSection />);
    expect(screen.getByTestId('public-schedule-url')).toHaveTextContent('/s/u/raver');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });
});
