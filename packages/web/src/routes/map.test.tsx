import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  festival: null as unknown,
  user: null as unknown,
  crew: null as unknown,
  useQuery: vi.fn(),
  useActiveCrew: vi.fn(),
  crewMapProps: vi.fn(),
  setActiveCrew: vi.fn(),
  search: {} as { focusStage?: string },
  navigate: vi.fn(),
  sosList: [] as unknown[],
  error: null as string | null,
  queryError: false,
  refetch: vi.fn(),
  loadFestivals: vi.fn(),
  selectFestival: vi.fn(),
}));

vi.mock('@festie/shared', () => ({ api: { get: vi.fn() } }));

vi.mock('@festie/shared/stores', () => {
  const pick = (value: () => unknown) => (sel: (s: unknown) => unknown) => sel(value());
  return {
    useFestivalStore: (sel: (s: unknown) => unknown) => sel({
      currentFestival: h.festival,
      stages: [],
      festivals: [],
      isLoading: false,
      error: h.error,
      loadFestivals: h.loadFestivals,
      selectFestival: h.selectFestival,
    }),
    useAuthStore: pick(() => ({ user: h.user })),
    };
});

vi.mock('@festie/shared/hooks', () => ({
  useActiveCrew: () => {
    h.useActiveCrew();
    return { crew: h.crew };
  },
}));

vi.mock('@festie/shared/stores/liveLocationStore', () => {
  const state = { peers: {}, get activeSosList() { return h.sosList; } };
  const useLiveLocationStore = (sel: (s: typeof state) => unknown) => sel(state);
  useLiveLocationStore.getState = () => ({ setActiveCrew: h.setActiveCrew, sweepStale: vi.fn() });
  return { useLiveLocationStore };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: unknown) => {
    h.useQuery(opts);
    return { data: [{ id: 'mp1', label: 'Gate' }], isError: h.queryError, refetch: h.refetch };
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => h.search,
  useNavigate: () => h.navigate,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../components/crew/CrewMap', () => ({
  default: (props: { meetingPoints: unknown[]; canvasClassName?: string; focusPinId?: string | null; onFocusHandled?: () => void }) => {
    h.crewMapProps(props);
    return <div data-testid="crew-map" />;
  },
}));

vi.mock('../components/crew/SosRaiseButton', () => ({
  default: () => <button type="button">SOS</button>,
}));

import MapView from './map';

beforeEach(() => {
  vi.clearAllMocks();
  h.festival = { id: 'f1', name: 'Fest' };
  h.user = null;
  h.crew = null;
  h.search = {};
  h.error = null;
  h.queryError = false;
  h.sosList = [];
});

describe('MapView', () => {
  it('shows the empty state when no festival is selected', () => {
    h.festival = null;
    render(<MapView />);
    expect(screen.getByText('No festival selected')).toBeInTheDocument();
    expect(screen.queryByTestId('crew-map')).not.toBeInTheDocument();
  });

  it('shows the load error and a retry when the festival list failed', () => {
    h.festival = null;
    h.error = 'Network down';
    render(<MapView />);
    expect(screen.getByText("Couldn't load festivals")).toBeInTheDocument();
    expect(screen.getByText('Network down')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('shows an alert and a retry when meeting points fail to load', () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1' };
    h.queryError = true;
    render(<MapView />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load meeting points.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it('renders the map for a guest with no meeting points and the guest line', async () => {
    render(<MapView />);
    expect(await screen.findByTestId('crew-map')).toBeInTheDocument();
    expect(h.crewMapProps.mock.calls[0]![0].meetingPoints).toHaveLength(0);
    expect(screen.getByText('Sign in and join a crew to see friends and meeting points here.')).toBeInTheDocument();
    expect(h.setActiveCrew).not.toHaveBeenCalled();
  });

  it('selects a crew itself so a hard load of /map still gets live peers', async () => {
    h.user = { id: 'u1' };
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(h.useActiveCrew).toHaveBeenCalled();
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

  it('passes focusStage to the map and clears the param when handled', async () => {
    h.search = { focusStage: 's1' };
    render(<MapView />);
    await screen.findByTestId('crew-map');
    const props = h.crewMapProps.mock.calls[0]![0];
    expect(props.focusPinId).toBe('s1');
    props.onFocusHandled();
    expect(h.navigate).toHaveBeenCalledWith({ to: '/map', search: {}, replace: true });
  });

  it('passes a null focusPinId without a focusStage', async () => {
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(h.crewMapProps.mock.calls[0]![0].focusPinId).toBeNull();
  });

  it('offers SOS to a crew member, and hides it while their own SOS is active', async () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1' };
    const { unmount } = render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.getByRole('button', { name: 'SOS' })).toBeInTheDocument();
    unmount();
    h.sosList = [{ crewId: 'c1', userId: 'u1' }];
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.queryByRole('button', { name: 'SOS' })).not.toBeInTheDocument();
  });

  it('shows no SOS for a guest', async () => {
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.queryByRole('button', { name: 'SOS' })).not.toBeInTheDocument();
  });
});
