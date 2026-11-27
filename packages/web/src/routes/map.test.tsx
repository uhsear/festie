import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  festival: null as unknown,
  user: null as unknown,
  crew: null as unknown,
  otherFestival: null as string | null,
  useQuery: vi.fn(),
  useActiveCrew: vi.fn(),
  crewMapProps: vi.fn(),
  setActiveCrew: vi.fn(),
  search: {} as { focusStage?: string },
  navigate: vi.fn(),
  sosList: [] as unknown[],
  error: null as string | null,
  queryError: false,
  queryData: [{ id: 'mp1', label: 'Gate' }] as unknown[],
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
  useMapCrew: () => {
    h.useActiveCrew();
    return { crew: h.crew, otherFestivalName: h.otherFestival };
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
    return { data: h.queryData, isError: h.queryError, refetch: h.refetch };
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => h.search,
  useNavigate: () => h.navigate,
  Link: ({ to, search, children, ...rest }: { to: string; search?: unknown; children: React.ReactNode }) => (
    <a href={to} data-search={JSON.stringify(search)} {...rest}>
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

vi.mock('../components/features/FreshnessChip', () => ({ default: () => <span>freshness-chip</span> }));
vi.mock('../components/features/OfflineStatusChip', () => ({ default: () => <span>offline-chip</span> }));


import MapView from './map';

beforeEach(() => {
  vi.clearAllMocks();
  h.festival = { id: 'f1', name: 'Fest' };
  h.user = null;
  h.crew = null;
  h.otherFestival = null;
  h.search = {};
  h.error = null;
  h.queryError = false;
  h.queryData = [{ id: 'mp1', label: 'Gate' }];
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
    h.queryData = [];
    render(<MapView />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load meeting points.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it('says it shows saved meeting points, not an error, when a refetch failed but data exists', () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1' };
    h.queryError = true;
    render(<MapView />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Showing your saved meeting points.')).toBeInTheDocument();
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
    expect(screen.getByText(/Join a crew to see friends/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Crew' })).toHaveAttribute('href', '/crew');
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

  it('has no in-page SOS control: the app shell owns the one SOS control', async () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1' };
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.queryByRole('button', { name: /SOS/ })).not.toBeInTheDocument();
  });

  it('centres the add action with the empty state, and keeps it at the left under a real map', async () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1' };
    const { container } = render(<MapView />);
    await screen.findByTestId('crew-map');
    const page = container.querySelector('.map-page')!;
    // The rule only fires when the page holds an empty state; the link keeps its own self-start.
    expect(page.className).toContain('[&:has(.empty-state)>a]:self-center');
    expect(screen.getByRole('link', { name: 'Add a meeting point' }).className).toContain('self-start');
    expect(screen.getByRole('link', { name: 'Add a meeting point' }).parentElement).toBe(page);
  });

  it('links a crew member to the Crew tab, where meeting points are added', async () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1' };
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.getByRole('link', { name: 'Add a meeting point' })).toHaveAttribute('href', '/crew');
    expect(screen.getByRole('link', { name: 'Add a meeting point' })).toHaveAttribute('data-search', '{"tab":"find"}');
    // A pill, not a bare underlined link, so it reads as the map's one action.
    expect(screen.getByRole('link', { name: 'Add a meeting point' }).className).toContain('rounded-full');
  });

  it('hides crew layers and SOS when the crew belongs to another festival', async () => {
    h.user = { id: 'u1' };
    h.crew = null;
    h.otherFestival = 'Wasteland';
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(h.crewMapProps.mock.calls[0]![0].meetingPoints).toHaveLength(0);
    expect(h.useQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(screen.getByText(/Your crew is for Wasteland/)).toBeInTheDocument();
    expect(screen.queryByText('freshness-chip')).not.toBeInTheDocument();
  });

  it('keeps crew layers when the crew belongs to the selected festival', async () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1', festivalId: 'f1' };
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(h.crewMapProps.mock.calls[0]![0].meetingPoints).toHaveLength(1);
  });

  it('shows the freshness chip for a crew member and the offline chip for any signed-in user', async () => {
    h.user = { id: 'u1' };
    h.crew = { id: 'c1', festivalId: 'f1' };
    const { unmount } = render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.getByText('freshness-chip')).toBeInTheDocument();
    expect(screen.getByText('offline-chip')).toBeInTheDocument();
    unmount();
    h.user = null;
    render(<MapView />);
    await screen.findByTestId('crew-map');
    expect(screen.queryByText('freshness-chip')).not.toBeInTheDocument();
    expect(screen.queryByText('offline-chip')).not.toBeInTheDocument();
  });
});
