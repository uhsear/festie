import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SetDeepLink from './set';

const mockNavigate = vi.fn();
const mockToast = vi.fn();
const mockSetDetailSet = vi.fn();
const mockApiGet = vi.fn();
const festivalState = {
  festivals: [{ id: 'f1' }],
  sets: [] as Array<{ id: string }>,
  currentFestivalId: 'f1',
  loadFestivals: vi.fn(),
  selectFestival: vi.fn(),
};

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ setId: 's1' }),
  useNavigate: () => mockNavigate,
}));
vi.mock('../lib/toastContext', () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock('@festie/shared/stores', () => ({ useFestivalStore: { getState: () => festivalState } }));
vi.mock('@festie/shared/stores/uiStore', () => ({
  useUIStore: { getState: () => ({ setDetailSet: mockSetDetailSet }) },
}));
vi.mock('@festie/shared/services', () => ({ api: { get: (...a: unknown[]) => mockApiGet(...a) } }));
vi.mock('../components/ui/skeletons/CardsSkeleton', () => ({ default: () => null }));

describe('SetDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    festivalState.sets = [];
  });

  it('toasts and redirects home when the set cannot be found', async () => {
    mockApiGet.mockRejectedValue({ status: 404 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<SetDeepLink />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/', replace: true }));
    expect(mockToast).toHaveBeenCalledWith('That set link is no longer available.', 'info');
  });

  it('shows an offline message with retry, and does not redirect, on a network error', async () => {
    mockApiGet.mockRejectedValueOnce({ isNetworkError: true, status: 0 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<SetDeepLink />);
    expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();

    festivalState.sets = [{ id: 's1' }];
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/', replace: true }));
    expect(mockSetDetailSet).toHaveBeenCalledWith({ id: 's1' });
  });

  it('opens the set without a toast when it is already in the store', async () => {
    festivalState.sets = [{ id: 's1' }];
    render(<SetDeepLink />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/', replace: true }));
    expect(mockSetDetailSet).toHaveBeenCalledWith({ id: 's1' });
    expect(mockToast).not.toHaveBeenCalled();
  });
});
