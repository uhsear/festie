import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DevicesSection from './DevicesSection';

interface Row { id: string; device: string | null; createdAt: string; lastAccess: string; current: boolean }

const mockSignOut = vi.fn();
const mockSignOutOthers = vi.fn();
const mockReload = vi.fn();
let state: { devices: Row[]; loading: boolean; error: string | null };

vi.mock('@festie/shared/hooks', () => ({
  useSignedInDevices: () => ({ ...state, reload: mockReload, signOut: mockSignOut, signOutOthers: mockSignOutOthers }),
  deviceTitle: (d: Row) => d.device ?? 'Unknown device',
  deviceSubtitle: (d: Row) => (d.current ? 'This device' : 'Last active 2h ago'),
}));

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const current: Row = { id: 's1', device: 'Chrome on Windows', createdAt: '', lastAccess: '', current: true };
const other: Row = { id: 's2', device: 'Festie app on iOS', createdAt: '', lastAccess: '', current: false };

beforeEach(() => {
  vi.clearAllMocks();
  mockSignOut.mockResolvedValue(undefined);
  mockSignOutOthers.mockResolvedValue(undefined);
  state = { devices: [current, other], loading: false, error: null };
});

describe('DevicesSection', () => {
  it('renders titles and subtitles, with no Sign out on the current row', () => {
    render(<DevicesSection />);
    expect(screen.getByText('Signed-in devices')).toBeInTheDocument();
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('Festie app on iOS')).toBeInTheDocument();
    expect(screen.getByText('Last active 2h ago')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out Chrome on Windows' })).not.toBeInTheDocument();
  });

  it('signs out one device from its row', async () => {
    const user = userEvent.setup();
    render(<DevicesSection />);
    await user.click(screen.getByRole('button', { name: 'Sign out Festie app on iOS' }));
    expect(mockSignOut).toHaveBeenCalledWith('s2');
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Signed out Festie app on iOS.', 'success'));
  });

  it('signs out all other devices after confirming', async () => {
    const user = userEvent.setup();
    render(<DevicesSection />);
    await user.click(screen.getByRole('button', { name: 'Sign out all other devices' }));
    await user.click(await screen.findByRole('button', { name: 'Sign out others' }));
    expect(mockSignOutOthers).toHaveBeenCalled();
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Signed out all other devices.', 'success'));
  });

  it('shows the only-this-device line for one row', () => {
    state.devices = [current];
    render(<DevicesSection />);
    expect(screen.getByText('Only this device is signed in.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out all other devices' })).not.toBeInTheDocument();
  });

  it('shows a load error with Try again', async () => {
    const user = userEvent.setup();
    state = { devices: [], loading: false, error: "Couldn't load your devices. Try again." };
    render(<DevicesSection />);
    expect(screen.getByText("Couldn't load your devices. Try again.")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockReload).toHaveBeenCalled();
  });
});
