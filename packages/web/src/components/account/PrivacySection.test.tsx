import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrivacySection from './PrivacySection';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { PRIVACY_COPY } from '@festie/shared/constants';

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockFetchStatus = vi.fn();
const mockStop = vi.fn();
vi.mock('@festie/shared/services/sharing', () => ({
  fetchSharingStatus: () => mockFetchStatus(),
  stopAllSharing: () => mockStop(),
}));

function setUser(over: Record<string, unknown> = {}) {
  useAuthStore.setState({
    user: { id: 'u1', username: 'me', publicSchedule: false, ...over } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchStatus.mockResolvedValue({ publicSchedule: false, publicFestival: null, linksResetAt: null, statusLocations: [] });
  mockStop.mockResolvedValue({ clearedStatusLocations: 0 });
  setUser();
  useLiveLocationStore.setState({ shareIntent: null });
  useCrewStore.setState({ crews: [], activeCrew: null, crewStatuses: [] });
  useUIStore.setState({ offlineMode: false });
});

describe('PrivacySection', () => {
  it('renders the six labels and both guarantee lines', async () => {
    render(<PrivacySection />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    for (const label of [
      PRIVACY_COPY.publicPage.label,
      PRIVACY_COPY.picksLinks.label,
      PRIVACY_COPY.paymentHandles.label,
      PRIVACY_COPY.liveLocation.label,
      PRIVACY_COPY.statusLocation.label,
      PRIVACY_COPY.profile.label,
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText(PRIVACY_COPY.noFriendGraph)).toBeInTheDocument();
    expect(screen.getByText(PRIVACY_COPY.freeOffline)).toBeInTheDocument();
  });

  it('disables Stop all sharing with nothing shared and shows the hint', async () => {
    render(<PrivacySection />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: PRIVACY_COPY.stopButton })).toBeDisabled();
    expect(screen.getByText(PRIVACY_COPY.stopHintNone)).toBeInTheDocument();
  });

  it('disables Stop all sharing when offline', async () => {
    setUser({ publicSchedule: true });
    useUIStore.setState({ offlineMode: true });
    render(<PrivacySection />);
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: PRIVACY_COPY.stopButton })).toBeDisabled();
  });

  it('confirms, stops and toasts', async () => {
    const user = userEvent.setup();
    setUser({ publicSchedule: true });
    render(<PrivacySection />);
    await user.click(screen.getByRole('button', { name: PRIVACY_COPY.stopButton }));
    await user.click(await screen.findByRole('button', { name: PRIVACY_COPY.confirmButton }));
    await waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Sharing stopped.', 'success'));
  });

  it('counts crews from the server status locations', async () => {
    mockFetchStatus.mockResolvedValue({
      publicSchedule: false,
      publicFestival: null,
      linksResetAt: null,
      statusLocations: [
        { crewId: 'a', crewName: 'A', capturedAt: null },
        { crewId: 'b', crewName: 'B', capturedAt: null },
      ],
    });
    render(<PrivacySection />);
    expect(await screen.findByText('2 crews see where you were last.')).toBeInTheDocument();
  });
});
