import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, renderHook, waitFor } from '@testing-library/react';
import type { Festival, PeerLocation, SosEntry } from '@festie/shared/types';
import { useSosMarkers } from './crew-map/useSosMarkers';
import { usePeerMarkers } from './crew-map/usePeerMarkers';
import { useStageMarkers } from './crew-map/useStageMarkers';
import type { GlRefObject, MapRefObject, GlMarker } from './crew-map/mapDom';

// --- Mocks ---
// Guard the maplibre-gl import: the component dynamic-import()s it inside an
// effect, and on the has-pins path that effect runs. We stub the GL library so
// no WebGL/canvas is ever touched in jsdom. The CSS side-import is stubbed too.
const mapInstances: Array<{
  on: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  flyTo: ReturnType<typeof vi.fn>;
}> = [];
const markerElements: HTMLElement[] = [];
vi.mock('maplibre-gl', () => {
  class Map {
    on = vi.fn();
    remove = vi.fn();
    addControl = vi.fn();
    fitBounds = vi.fn();
    flyTo = vi.fn();
    getZoom = () => 15;
    off = vi.fn();
    constructor() {
      mapInstances.push(this as unknown as (typeof mapInstances)[number]);
    }
  }
  class Marker {
    constructor(opts?: { element?: HTMLElement }) {
      if (opts?.element) markerElements.push(opts.element);
    }
    remove() {}
    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  class Popup {
    setHTML() {
      return this;
    }
    setDOMContent() {
      return this;
    }
  }
  class NavigationControl {}
  class LngLatBounds {
    extend() {
      return this;
    }
  }
  // maplibre-gl v6 is ESM-only with NO default export — mirror its named shape.
  return { Map, Marker, Popup, NavigationControl, LngLatBounds, addProtocol: vi.fn(), setWorkerUrl: vi.fn() };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
// The `?worker&url` side-import exists so Vite emits the GL worker chunk; jsdom
// has no worker to point at, so stub the URL it resolves to.
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'stub-worker-url' }));

// Drive pin-derivation deterministically: the real shared util is pure, but
// mocking it keeps this test focused on CrewMap's own branching (empty vs map).
const { extractMeetingPointPins, extractStagePins, extractAmenityPins, hasOfflineBasemap, pmtilesImport } = vi.hoisted(
  () => ({
  extractMeetingPointPins: vi.fn(),
  extractStagePins: vi.fn(() => [] as unknown[]),
  extractAmenityPins: vi.fn(() => [] as unknown[]),
  hasOfflineBasemap: vi.fn(() => false),
  pmtilesImport: vi.fn(),
  }),
);
// The pmtiles protocol is registered by a dynamic import inside the map-lifecycle
// effect. Stub the module so the offline-basemap branch can be driven, and so a
// failed chunk load — the normal offline-first failure — can be simulated.
vi.mock('pmtiles', () => pmtilesImport());
vi.mock('@festie/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/utils')>()),
  extractMeetingPointPins,
  extractStagePins,
  extractAmenityPins,
  extractZones: () => [],
  zonesGeoJSON: () => ({ type: 'FeatureCollection', features: [] }),
  zoneLabels: () => [],
  extractSiteplan: () => null,
  siteplanImageSource: () => null,
  amenityGlyph: () => ({ glyph: '?', color: '#888888' }),
  pinsCentroid: (pins: Array<{ latitude: number; longitude: number }>) =>
    pins.length ? { latitude: pins[0].latitude, longitude: pins[0].longitude } : null,
  // Mirror the real precedence enough for these tests: with no map-config the
  // camera centres on the first pin (centroid stand-in) and never fits bounds.
  pickFestivalCamera: (_festival: unknown, pins: Array<{ latitude: number; longitude: number }>) => ({
    center: pins.length ? { latitude: pins[0].latitude, longitude: pins[0].longitude } : null,
    bounds: null,
  }),
  formatStaleness: () => 'as of just now',
  // Needed by the map-lifecycle effect itself: without these four the effect
  // threw on the first missing export and no GL map was ever constructed, so
  // the maplibre-gl mock below went unexercised.
  pickMapStyle: () => ({ version: 8, sources: {}, layers: [] }),
  hasOfflineBasemap,
  buildPursuit: () => null,
}));

vi.mock('lucide-react', () => ({
  MapPin: () => <span data-testid="map-pin-icon" />,
  AlertTriangle: () => <span data-testid="alert-icon" />,
  Navigation: () => <span />,
  X: () => <span />,
  LocateFixed: () => <span />,
}));

import CrewMap from './CrewMap';

const POINT_WITH_COORDS = {
  id: 'mp1',
  label: 'Main Gate',
  location: 'By the entrance',
  active: true,
  latitude: 41.88,
  longitude: -87.62,
};
const POINT_NO_COORDS = { id: 'mp2', label: 'Food court', location: 'Center', active: true };

beforeEach(() => {
  vi.clearAllMocks();
  mapInstances.length = 0;
  markerElements.length = 0;
  hasOfflineBasemap.mockReturnValue(false);
  extractStagePins.mockReturnValue([]);
  extractAmenityPins.mockReturnValue([]);
});

describe('CrewMap', () => {
  it('renders the empty state when no points have coords', () => {
    // No coord-bearing points → util yields no pins.
    extractMeetingPointPins.mockReturnValue([]);
    render(<CrewMap meetingPoints={[POINT_NO_COORDS]} />);
    expect(screen.getByText('No mapped meeting points yet')).toBeInTheDocument();
    expect(screen.getByText(/add a location to a meeting point/i)).toBeInTheDocument();
    // It must NOT attempt to construct a GL map on the empty path.
    expect(mapInstances).toHaveLength(0);
  });

  it('renders the map container, not the empty state, when authoring with nothing to plot', () => {
    extractMeetingPointPins.mockReturnValue([]);
    render(<CrewMap meetingPoints={[]} authoring />);
    expect(screen.queryByText('No mapped meeting points yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Crew map with meeting points and live locations')).toBeInTheDocument();
    expect(screen.getByText('Click Set location, then click the map.')).toBeInTheDocument();
  });

  it('surfaces the honest "not mapped yet" note in the empty state', () => {
    extractMeetingPointPins.mockReturnValue([]);
    render(<CrewMap meetingPoints={[]} />);
    expect(screen.getByText(/this festival isn.t mapped yet/i)).toBeInTheDocument();
  });

  it('renders the map container (not the empty state) when at least one pin has coords', () => {
    extractMeetingPointPins.mockReturnValue([
      {
        id: 'mp1',
        kind: 'meeting-point',
        label: 'Main Gate',
        sublabel: 'By the entrance',
        latitude: 41.88,
        longitude: -87.62,
      },
    ]);
    render(<CrewMap meetingPoints={[POINT_WITH_COORDS]} />);
    expect(screen.queryByText('No mapped meeting points yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Crew map with meeting points and live locations')).toBeInTheDocument();
    // Single-pin count copy.
    expect(screen.getByText(/1 mapped point/)).toBeInTheDocument();
  });

  it('sizes the canvas with h-72 by default and canvasClassName when given', () => {
    extractMeetingPointPins.mockReturnValue([]);
    const { rerender } = render(<CrewMap meetingPoints={[]} authoring />);
    const label = 'Crew map with meeting points and live locations';
    expect(screen.getByLabelText(label)).toHaveClass('h-72');
    rerender(<CrewMap meetingPoints={[]} authoring canvasClassName="h-96" />);
    expect(screen.getByLabelText(label)).toHaveClass('h-96');
    expect(screen.getByLabelText(label)).not.toHaveClass('h-72');
  });

  it('derives pins from the provided meeting points via the shared util', () => {
    extractMeetingPointPins.mockReturnValue([]);
    render(<CrewMap meetingPoints={[POINT_WITH_COORDS, POINT_NO_COORDS]} />);
    expect(extractMeetingPointPins).toHaveBeenCalledWith([POINT_WITH_COORDS, POINT_NO_COORDS]);
  });

  it('renders the map (not the empty state) when there are live peers but no pins', () => {
    extractMeetingPointPins.mockReturnValue([]);
    const peers = [
      { crewId: 'c1', userId: 'u1', username: 'Dana', lat: 41.88, lng: -87.62, capturedAt: 'x', serverAt: 'x' },
    ];
    render(<CrewMap meetingPoints={[]} peers={peers} />);
    expect(screen.queryByText('No mapped meeting points yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Crew map with meeting points and live locations')).toBeInTheDocument();
    // Honest count copy reflects live crew members.
    expect(screen.getByText(/1 live crew member/)).toBeInTheDocument();
  });

  it('pluralizes the live-crew count copy', () => {
    extractMeetingPointPins.mockReturnValue([]);
    const peers = [
      { crewId: 'c1', userId: 'u1', username: 'Dana', lat: 41.88, lng: -87.62, capturedAt: 'x', serverAt: 'x' },
      { crewId: 'c1', userId: 'u2', username: 'Eli', lat: 41.89, lng: -87.63, capturedAt: 'x', serverAt: 'x' },
    ];
    render(<CrewMap meetingPoints={[]} peers={peers} />);
    expect(screen.getByText(/2 live crew members/)).toBeInTheDocument();
  });

  it('renders the map when only an SOS with a position is present', () => {
    extractMeetingPointPins.mockReturnValue([]);
    const sos = {
      crewId: 'c1',
      userId: 'u1',
      username: 'Dana',
      raisedAt: 'x',
      position: { lat: 41.88, lng: -87.62, capturedAt: 'x' },
    };
    render(<CrewMap meetingPoints={[]} sos={sos} />);
    expect(screen.queryByText('No mapped meeting points yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Crew map with meeting points and live locations')).toBeInTheDocument();
  });

  it('stays in the empty state for an SOS that has no position', () => {
    extractMeetingPointPins.mockReturnValue([]);
    const sos = { crewId: 'c1', userId: 'u1', username: 'Dana', raisedAt: 'x' };
    render(<CrewMap meetingPoints={[]} sos={sos} />);
    expect(screen.getByText('No mapped meeting points yet')).toBeInTheDocument();
    expect(mapInstances).toHaveLength(0);
  });

  // maplibre-gl v6 is ESM-only with no default export. This asserts the map is
  // really constructed off the dynamic import, so reintroducing `.default`
  // (which would be undefined) fails here instead of only in the browser.
  it('constructs a GL map from the maplibre-gl module namespace', async () => {
    extractMeetingPointPins.mockReturnValue([
      { id: 'mp1', kind: 'meeting-point', label: 'Main Gate', sublabel: '', latitude: 41.88, longitude: -87.62 },
    ]);
    render(<CrewMap meetingPoints={[POINT_WITH_COORDS]} />);
    await waitFor(() => expect(mapInstances).toHaveLength(1));
  });

  it('retries the pmtiles registration after a failed chunk load', async () => {
    // The registration latch is process-global, so a failed attempt that left it
    // claimed would skip registration for every later mount and leave the offline
    // vector basemap dead until a full reload.
    const maplibregl = await import('maplibre-gl');
    hasOfflineBasemap.mockReturnValue(true);
    extractMeetingPointPins.mockReturnValue([
      { id: 'mp1', kind: 'meeting-point', label: 'Main Gate', sublabel: '', latitude: 41.88, longitude: -87.62 },
    ]);

    // First mount: the pmtiles chunk is not in the service-worker cache.
    pmtilesImport.mockImplementation(() => {
      throw new Error('chunk load failed');
    });
    const first = render(<CrewMap meetingPoints={[POINT_WITH_COORDS]} />);
    await waitFor(() => expect(maplibregl.addProtocol).not.toHaveBeenCalled());
    first.unmount();

    // Second mount: the chunk loads. The latch must have released.
    pmtilesImport.mockReturnValue({ Protocol: class { tile = vi.fn(); } });
    render(<CrewMap meetingPoints={[POINT_WITH_COORDS]} />);
    await waitFor(() => expect(maplibregl.addProtocol).toHaveBeenCalledWith('pmtiles', expect.anything()));
  });
});

// The SOS marker DOM element is built inside the useSosMarkers hook (never
// reached via a full CrewMap render in jsdom — see the "marker code is inert
// there" note atop CrewMap.tsx). Drive the hook directly with fake map/gl
// handles so the SOS marker's a11y attributes and Enter/Space handling — the
// same treatment the other four marker hooks already give theirs — are
// actually exercised.
describe('useSosMarkers keyboard accessibility', () => {
  const sos: SosEntry = {
    crewId: 'c1',
    userId: 'u1',
    username: 'Dana',
    raisedAt: 'x',
    position: { lat: 41.88, lng: -87.62, capturedAt: 'x' },
  };

  class FakeMarker {
    element: HTMLElement;
    togglePopup = vi.fn();
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  class FakePopup {
    setDOMContent() {
      return this;
    }
  }

  function setup() {
    const fakeMap = { flyTo: vi.fn() } as unknown as MapRefObject['current'];
    const fakeGl = { Marker: FakeMarker, Popup: FakePopup } as unknown as GlRefObject['current'];
    const mapRef: MapRefObject = { current: fakeMap };
    const glRef: GlRefObject = { current: fakeGl };
    const markersRef = { current: new Map<string, GlMarker>() };
    const framedRef = { current: new Set<string>() };
    const selectPursue = vi.fn();
    renderHook(() =>
      useSosMarkers(mapRef, glRef, 'ready', [sos], sos.userId, `${sos.userId}:41.88,-87.62`, markersRef, framedRef, selectPursue),
    );
    const marker = markersRef.current.get('u1') as unknown as FakeMarker;
    return { marker, selectPursue };
  }

  it('makes the SOS marker a keyboard-focusable button (role + tabindex), matching the other marker types', () => {
    const { marker } = setup();
    expect(marker.element.getAttribute('role')).toBe('button');
    expect(marker.element.getAttribute('tabindex')).toBe('0');
  });

  it('opens the popup and pursues the raiser on Enter, same as clicking it', () => {
    const { marker, selectPursue } = setup();
    // The build effect already toggles the popup once itself (frame-once on
    // first appearance) — assert the keydown triggers one MORE toggle, not an
    // absolute count.
    const togglesBeforeKeydown = marker.togglePopup.mock.calls.length;
    marker.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(marker.togglePopup.mock.calls.length).toBe(togglesBeforeKeydown + 1);
    expect(selectPursue).toHaveBeenCalledWith({
      id: 'sos:u1',
      label: 'Dana — SOS',
      coord: { latitude: 41.88, longitude: -87.62 },
    });
  });
});

// --- Place card, Nearest, self dot and focus (T49) ---
const FESTIVAL = { id: 'f1' } as unknown as Festival;
const STAGE_PIN = { id: 's1', kind: 'stage', label: 'Mainstage', latitude: 28.5, longitude: -81.4 };
const amenity = (id: string, amenityType: string, label: string) => ({
  id,
  kind: 'amenity',
  label,
  amenityType,
  latitude: 28.5,
  longitude: -81.4,
});

const watchPosition = vi.fn();
function stubGeolocation() {
  watchPosition.mockReset().mockReturnValue(1);
  Object.defineProperty(global.navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition, clearWatch: vi.fn() },
  });
}

async function renderReadyMap(props: Partial<React.ComponentProps<typeof CrewMap>> = {}) {
  // One meeting pin so the map renders even when no stages or amenities are mapped.
  extractMeetingPointPins.mockReturnValue([
    { id: 'mp1', kind: 'meeting-point', label: 'Main Gate', sublabel: '', latitude: 41.88, longitude: -87.62 },
  ]);
  const view = render(<CrewMap meetingPoints={[]} festival={FESTIVAL} {...props} />);
  await waitFor(() => expect(mapInstances).toHaveLength(1));
  const load = mapInstances[0].on.mock.calls.find((c) => c[0] === 'load')![1] as () => void;
  act(() => load());
  return view;
}

describe('CrewMap place card and Nearest', () => {
  beforeEach(stubGeolocation);

  it('labels filter chips with readable names, never the raw enum or the word pursue', () => {
    extractMeetingPointPins.mockReturnValue([]);
    extractAmenityPins.mockReturnValue([amenity('a1', 'atm', 'ATM'), amenity('a2', 'info', 'Info')]);
    render(<CrewMap meetingPoints={[]} festival={FESTIVAL} />);
    expect(screen.getByRole('button', { name: 'Hide ATM' })).toHaveTextContent('ATM');
    expect(screen.getByRole('button', { name: 'Hide Info' })).toHaveTextContent('Info');
    expect(screen.queryByText(/pursu/i)).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/pursu/i);
  });

  it('says so when no medical pin is mapped and offers Call 911', () => {
    extractMeetingPointPins.mockReturnValue([]);
    extractAmenityPins.mockReturnValue([amenity('a1', 'water', 'Water')]);
    render(<CrewMap meetingPoints={[]} festival={FESTIVAL} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the way to the nearest medical' }));
    expect(screen.getByText(/No medical tent is mapped/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 911' })).toHaveAttribute('href', 'tel:911');
    expect(watchPosition).not.toHaveBeenCalled();
  });

  it('starts location and shows Finding you when a medical pin exists and there is no fix', () => {
    extractMeetingPointPins.mockReturnValue([]);
    extractAmenityPins.mockReturnValue([amenity('a1', 'medical', 'First aid')]);
    render(<CrewMap meetingPoints={[]} festival={FESTIVAL} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show the way to the nearest medical' }));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Finding you…')).toBeInTheDocument();
  });

  it('shows no Show my location button while authoring', async () => {
    await renderReadyMap({ authoring: true });
    expect(screen.queryByRole('button', { name: 'Show my location' })).toBeNull();
  });

  it('adds the self dot only once a fix exists', async () => {
    await renderReadyMap();
    expect(markerElements.some((el) => el.classList.contains('festie-self-marker'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }));
    expect(watchPosition).toHaveBeenCalledTimes(1);
    act(() => watchPosition.mock.calls[0][0]({ coords: { latitude: 28.5, longitude: -81.4, accuracy: 20 } }));
    const dot = markerElements.find((el) => el.classList.contains('festie-self-marker'));
    expect(dot).toBeDefined();
    expect(dot!.getAttribute('aria-label')).toBe('You are here, accurate to about 20 m');
    expect(mapInstances[0].flyTo).toHaveBeenCalled();
  });

  it('tells the user when Show my location is blocked', async () => {
    await renderReadyMap();
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }));
    act(() => watchPosition.mock.calls[0][1]({ code: 1 }));
    expect(screen.getByText(/Location is blocked/)).toBeInTheDocument();
  });

  it('opens the card for a mapped focusPinId once and reports it handled', async () => {
    extractStagePins.mockReturnValue([STAGE_PIN]);
    const onFocusHandled = vi.fn();
    await renderReadyMap({ focusPinId: 's1', onFocusHandled });
    expect(await screen.findByRole('dialog', { name: 'Mainstage' })).toBeInTheDocument();
    expect(onFocusHandled).toHaveBeenCalledTimes(1);
    expect(mapInstances[0].flyTo).toHaveBeenCalledWith(expect.objectContaining({ zoom: 17 }));
  });

  it('does nothing for an unknown focusPinId', async () => {
    extractStagePins.mockReturnValue([STAGE_PIN]);
    const onFocusHandled = vi.fn();
    await renderReadyMap({ focusPinId: 'nope', onFocusHandled });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onFocusHandled).not.toHaveBeenCalled();
  });
});

describe('useStageMarkers place selection', () => {
  class FakeMarker {
    element: HTMLElement;
    popup = false;
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat() {
      return this;
    }
    setPopup() {
      this.popup = true;
      return this;
    }
    addTo() {
      return this;
    }
  }

  function setup(onSelectPlace?: (pin: unknown) => void) {
    const mapRef = { current: {} } as unknown as MapRefObject;
    const glRef = { current: { Marker: FakeMarker } } as unknown as GlRefObject;
    const markersRef = { current: [] as GlMarker[] };
    renderHook(() =>
      useStageMarkers(mapRef, glRef, 'ready', [STAGE_PIN] as never, 's1', markersRef, onSelectPlace as never),
    );
    return markersRef.current[0] as unknown as FakeMarker;
  }

  it('calls the callback on click and Enter, with no popup', () => {
    const onSelect = vi.fn();
    const marker = setup(onSelect);
    marker.element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    marker.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith(STAGE_PIN);
    expect(marker.popup).toBe(false);
  });

  it('adds no click listener without a callback, so taps reach the map', () => {
    const marker = setup();
    const parentClick = vi.fn();
    const parent = document.createElement('div');
    parent.addEventListener('click', parentClick);
    parent.appendChild(marker.element);
    marker.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(parentClick).toHaveBeenCalledTimes(1);
  });
});

describe('usePeerMarkers near-stage label', () => {
  class FakeMarker {
    element: HTMLElement;
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
    togglePopup() {}
  }
  class FakePopup {
    setDOMContent() {
      return this;
    }
  }
  const peer: PeerLocation = {
    crewId: 'c1',
    userId: 'u1',
    username: 'Ana',
    lat: 41.88,
    lng: -87.62,
    serverAt: new Date().toISOString(),
  } as PeerLocation;

  function labelWithStageAt(dLat: number): string {
    const mapRef = { current: {} } as unknown as MapRefObject;
    const glRef = { current: { Marker: FakeMarker, Popup: FakePopup } } as unknown as GlRefObject;
    const markersRef = { current: [] as GlMarker[] };
    const stage = { id: 's1', kind: 'stage', label: 'Main Stage', sublabel: '', latitude: 41.88 + dLat, longitude: -87.62 };
    renderHook(() =>
      usePeerMarkers(mapRef, glRef, 'ready', [peer], 'k', [stage] as never, 's1', markersRef, vi.fn()),
    );
    return (markersRef.current[0] as unknown as FakeMarker).element.getAttribute('aria-label') ?? '';
  }

  it('adds near Main Stage within 150 m', () => {
    expect(labelWithStageAt(0.0009)).toContain('near Main Stage'); // ~100 m
  });

  it('omits it at 200 m', () => {
    expect(labelWithStageAt(0.0018)).not.toContain('near Main Stage'); // ~200 m
  });
});
