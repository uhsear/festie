import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
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

  it('opens the set without a toast when it is already in the store', async () => {
    festivalState.sets = [{ id: 's1' }];
    render(<SetDeepLink />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ to: '/', replace: true }));
    expect(mockSetDetailSet).toHaveBeenCalledWith({ id: 's1' });
    expect(mockToast).not.toHaveBeenCalled();
  });
});
