import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPut = vi.fn();
const mockSetUser = vi.fn();
const mockFetchStatus = vi.fn();
const mockReset = vi.fn();
const mockToast = vi.fn();
let storeUser: Record<string, unknown>;

vi.mock('@festie/shared/stores/authStore', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ user: storeUser, setUser: mockSetUser }),
}));
vi.mock('@festie/shared/services/api', () => ({ api: { put: (...a: unknown[]) => mockPut(...a) } }));
vi.mock('@festie/shared/services/sharing', () => ({
  fetchSharingStatus: (...a: unknown[]) => mockFetchStatus(...a),
  resetShareLinks: (...a: unknown[]) => mockReset(...a),
}));
vi.mock('../../lib/toastContext', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('lucide-react')>()),
  Globe: () => <span />,
}));

import PublicScheduleSection from './PublicScheduleSection';

describe('PublicScheduleSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeUser = { id: 'u1', username: 'raver' };
    mockPut.mockResolvedValue({ user: { publicSchedule: true } });
    mockFetchStatus.mockResolvedValue({
      publicSchedule: true,
      publicFestival: { id: 'f1', name: 'EDC Orlando' },
      linksResetAt: null,
    });
    mockReset.mockResolvedValue({ linksResetAt: '2026-11-01T00:00:00Z' });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });

  it('is off by default and hides the link', () => {
    render(<PublicScheduleSection />);
    expect(screen.getByRole('switch', { name: 'Public schedule page' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByTestId('public-schedule-url')).toBeNull();
    expect(mockFetchStatus).not.toHaveBeenCalled();
  });

  it('turning it on saves the flag', async () => {
    render(<PublicScheduleSection />);
    await userEvent.click(screen.getByRole('switch'));
    expect(mockPut).toHaveBeenCalledWith('/account/public-schedule', { publicSchedule: true });
    await waitFor(() =>
      expect(mockSetUser).toHaveBeenCalledWith(expect.objectContaining({ publicSchedule: true })),
    );
  });

  it('shows the link, copy and open buttons when on', () => {
    storeUser = { id: 'u1', username: 'raver', publicSchedule: true };
    render(<PublicScheduleSection />);
    expect(screen.getByTestId('public-schedule-url')).toHaveTextContent('/s/u/raver');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    const open = screen.getByRole('link', { name: 'Open' });
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('names the newest festival from the sharing status', async () => {
    storeUser = { id: 'u1', username: 'raver', publicSchedule: true };
    render(<PublicScheduleSection />);
    expect(await screen.findByText(/Shows your picks for EDC Orlando\./)).toBeInTheDocument();
  });

  it('says to join a festival when there is none', async () => {
    storeUser = { id: 'u1', username: 'raver', publicSchedule: true };
    mockFetchStatus.mockResolvedValue({ publicSchedule: true, publicFestival: null, linksResetAt: null });
    render(<PublicScheduleSection />);
    expect(await screen.findByText('Join a festival and pick a set to fill this page.')).toBeInTheDocument();
  });

  it('hides Share when navigator.share is missing and shows it when present', () => {
    storeUser = { id: 'u1', username: 'raver', publicSchedule: true };
    const { unmount } = render(<PublicScheduleSection />);
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    unmount();
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true });
    render(<PublicScheduleSection />);
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
  });

  it('reset asks first and calls resetShareLinks only after Reset links', async () => {
    render(<PublicScheduleSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset my share links' }));
    expect(screen.getByText('Reset all your share links?')).toBeInTheDocument();
    expect(mockReset).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reset links' }));
    await waitFor(() => expect(mockReset).toHaveBeenCalledTimes(1));
    expect(mockToast).toHaveBeenCalledWith(
      'Done. Your old links no longer work. Share picks makes a new one.',
      'success',
    );
  });

  it('shows an error toast when reset fails', async () => {
    mockReset.mockRejectedValue(new Error('boom'));
    render(<PublicScheduleSection />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset my share links' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset links' }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        "Couldn't reset your links. Check your connection and try again.",
        'error',
      ),
    );
  });
});
