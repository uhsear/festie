import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  festival: null as unknown,
  user: null as unknown,
  crew: null as unknown,
  useQuery: vi.fn(),
  crewMapProps: vi.fn(),
  setActiveCrew: vi.fn(),
}));

vi.mock('@festie/shared', () => ({ api: { get: vi.fn() } }));

vi.mock('@festie/shared/stores', () => {
  const pick = (value: () => unknown) => (sel: (s: unknown) => unknown) => sel(value());
  return {
    useFestivalStore: (sel: (s: unknown) => unknown) => sel({ currentFestival: h.festival, stages: [] }),
    useAuthStore: pick(() => ({ user: h.user })),
    useCrewStore: pick(() => ({ activeCrew: h.crew })),
  };
});

vi.mock('@festie/shared/stores/liveLocationStore', () => {
  const state = { peers: {}, activeSosList: [] };
  const useLiveLocationStore = (sel: (s: typeof state) => unknown) => sel(state);
  useLiveLocationStore.getState = () => ({ setActiveCrew: h.setActiveCrew, sweepStale: vi.fn() });
  return { useLiveLocationStore };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => {
    h.useQuery(opts);
    return { data: [{ id: 'mp1', label: 'Gate' }] };
  },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../components/crew/CrewMap', () => ({
  default: (props: { meetingPoints: unknown[]; canvasClassName?: string }) => {
    h.crewMapProps(props);
    return <div data-testid="crew-map" />;
  },
}));

import MapView from './map';

beforeEach(() => {
  vi.clearAllMocks();
  h.festival = { id: 'f1', name: 'Fest' };
  h.user = null;
  h.crew = null;
});

describe('MapView', () => {
  it('shows the empty state when no festival is selected', () => {
    h.festival = null;
    render(<MapView />);
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
    expect(screen.queryByTestId('crew-map')).not.toBeInTheDocument();
  });

  it('renders the map for a guest with no meeting points and the guest line', async () => {
    render(<MapView />);
    expect(await screen.findByTestId('crew-map')).toBeInTheDocument();
    expect(h.crewMapProps.mock.calls[0]![0].meetingPoints).toHaveLength(0);
    expect(screen.getByText('Sign in and join a crew to see friends and meeting points here.')).toBeInTheDocument();
    expect(h.setActiveCrew).not.toHaveBeenCalled();
  });

  it('links to /crew for a signed-in user without a crew', async () => {
    h.user = { id: 'u1' };
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.getByRole('link', { name: 'crew' })).toHaveAttribute('href', '/crew');
  });

  it('fetches meeting points under the shared cache key for a crew member', async () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1' };
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(h.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['meeting-points', 'c1'], enabled: true }),
    );
    expect(h.crewMapProps.mock.calls[0]![0].meetingPoints).toHaveLength(1);
    expect(h.setActiveCrew).toHaveBeenCalledWith('c1');
  });
});
