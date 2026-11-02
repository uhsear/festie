// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, AlertTriangle, Navigation, X, LocateFixed } from 'lucide-react';
import {
  extractMeetingPointPins,
  extractStagePins,
  extractAmenityPins,
  extractZones,
  extractSiteplan,
  amenityGlyph,
  pickFestivalCamera,
  buildPursuit,
  pickMapStyle,
  hasOfflineBasemap,
  MAP_AMENITY_CATEGORIES,
  NEAREST_AMENITY_TYPES,
  MAP_COPY,
  humanizeAmenityType,
  locationPromptCopy,
  nearestMissingCopy,
  nearestStep,
  nearestTarget,
  placeFromPin,
  placeTarget,
  findMapPin,
  type MapPlace,
  type NearestStep,
  type MapPin as Pin,
} from '@festie/shared/utils';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { CrewMeetingPoint, PeerLocation, SosEntry, Festival, Stage, AmenityType } from '@festie/shared/types';
import EmptyState from '../ui/EmptyState';
import { type MapLibre, type PursueTarget } from './crew-map/mapDom';
import { useGeolocationWatch } from './crew-map/useGeolocationWatch';
import { useSelfMarker } from './crew-map/useSelfMarker';
import PlaceCard from './crew-map/PlaceCard';
import { useMeetingPointMarkers } from './crew-map/useMeetingPointMarkers';
import { useStageMarkers } from './crew-map/useStageMarkers';
import { useAmenityMarkers } from './crew-map/useAmenityMarkers';
import { usePeerMarkers } from './crew-map/usePeerMarkers';
import { useSosMarkers } from './crew-map/useSosMarkers';
import { useZoneLayer } from './crew-map/useZoneLayer';
import { useSiteplanLayer } from './crew-map/useSiteplanLayer';
import { useDraftMarkers } from './crew-map/useDraftMarkers';
import { useMapFraming } from './crew-map/useMapFraming';

/**
 * CrewMap — web crew map (MapLibre GL JS, no API key).
 *
 * Renders three marker kinds, all derived from props (never from internal fetch):
 *   1. meeting-point pins (F4 coords) — the original behaviour,
 *   2. live peer markers (ephemeral live-location, from the liveLocationStore),
 *   3. an emphasized SOS marker when a crew member raised one.
 *
 * MapLibre is HEAVY (~200 kB gzip) and is dynamically `import()`-ed inside an
 * effect (and the whole component is `lazy()`-loaded by its caller), so it never
 * lands in the main bundle and never touches the vitest/jsdom path (tests stub
 * the GL lib but its `load` callback never fires, so marker code is inert there).
 *
 * The GL map instance is created ONCE and kept across peer updates — peer/SOS
 * markers are rebuilt on their own effects (see crew-map/*) so a 10-second
 * position tick never tears down and rebuilds the whole map (which would churn
 * tiles + lose viewport). Each per-concern hook reads its live array through a
 * ref and keys its effect on a stable content string, so the deps are honest.
 *
 * HONESTY: peer freshness is rendered as "Live · N ago" from the server receive
 * time, and accuracy as a "±N m" radius note — we never imply a pinpoint fix.
 */

// Minimal structural shape this map needs — matches both @festie/shared's
// CrewMeetingPoint and MeetingPointsTab's local server row (snake_case).
export interface MappableMeetingPoint {
  id: string;
  label: string;
  location?: string | null;
  active?: boolean;
  latitude?: number | null;
  longitude?: number | null;
}

interface Props {
  /** Admin map editor: always render the canvas, even with nothing to plot yet. */
  authoring?: boolean;
  meetingPoints: MappableMeetingPoint[];
  /** Pursue this SOS raiser (from an SOS banner). The live coordinate comes from the SOS list. */
  focusSosUserId?: string;
  /** Live peer positions (ephemeral). Empty/omitted keeps the original behaviour. */
  peers?: PeerLocation[];
  /**
   * Active SOS for this crew, or null. Back-compat single-SOS input — when
   * `activeSosList` is omitted this is the only SOS plotted.
   */
  sos?: SosEntry | null;
  /**
   * All currently-active crew SOS (newest first), from the liveLocationStore's
   * `activeSosList`. When provided it supersedes the single `sos` prop and a
   * marker is rendered for EACH entry (each framed once on first appearance).
   * Omitted ⇒ falls back to `[sos]` so existing single-SOS callers are unchanged.
   */
  activeSosList?: SosEntry[];
  /**
   * The current festival, carrying `mapConfig` (amenities + camera) and — when
   * the caller folds the store's separate `stages` array in — `stages[]` for
   * stage pins. Omitted/null keeps the original meeting-points-only behaviour and
   * the "not mapped yet" fallback. Backward-compatible: a festival with no map
   * data yields no stage/amenity pins and no map-config camera.
   */
  festival?: (Festival & { stages?: Stage[] }) | null;
  /**
   * Admin authoring hook (Phase D). When provided, a click anywhere on the map
   * reports its coordinate so the festival-map editor can place/move a stage pin
   * or drop an amenity. Omitted (the default) leaves the map read-only — exactly
   * the prior behaviour. Web uses maplibre's native `click` event directly; no
   * WebView bridge involved (that's mobile-only).
   */
  onMapClick?: (coord: { latitude: number; longitude: number }) => void;
  /**
   * In-progress authoring vertices/corners (web-parity with the native
   * OfflineMap). While an admin draws a zone or places the 4 site-plan corners,
   * each tapped point is pushed here so a small aqua dot renders at it — giving
   * per-tap feedback BELOW the threshold where the polygon/overlay can render.
   * Omitted/empty in normal crew use — no dots drawn. Backward-compatible.
   */
  draftPoints?: { latitude: number; longitude: number }[];
  /** Height classes for the map canvas. Defaults to the 288 px crew-tab size. */
  canvasClassName?: string;
  /** A stage pin id to fly to and open on arrival (from "Show stage on map"). */
  focusPinId?: string | null;
  /** Called once the focus was applied, so the caller can clear its search param. */
  onFocusHandled?: () => void;
  /** Offers "Set as meeting point" on a place card. Omit for guests. */
  onSetMeetingPoint?: (place: MapPlace) => void;
}

// One-shot guard for the process-global `maplibregl.addProtocol('pmtiles', …)`
// registration below (see the map-lifecycle effect). It holds the in-flight
// registration rather than a boolean so concurrent map mounts await the SAME
// attempt instead of racing past a not-yet-set flag, and so a failed attempt
// clears itself and the next mount can retry.
let pmtilesRegistration: Promise<void> | null = null;

// Basemap style is chosen by the shared `pickMapStyle` (Phase 3A): a festival
// with an `offlineBasemap.pmtilesUrl` gets a PMTiles VECTOR basemap; every other
// festival gets the online OpenFreeMap style for the current theme.

// Placeholder target: liveTarget swaps in the SOS's real coordinate from sosList.
function sosPursueTarget(userId?: string): PursueTarget | null {
  return userId ? { id: 'sos:' + userId, label: '', coord: { latitude: 0, longitude: 0 } } : null;
}

export default function CrewMap({
  meetingPoints,
  focusSosUserId,
  peers = [],
  sos = null,
  activeSosList,
  festival = null,
  onMapClick,
  draftPoints,
  authoring = false,
  canvasClassName = 'h-72',
  focusPinId,
  onFocusHandled,
  onSetMeetingPoint,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 'pending' until we know whether the GL library mounted; flips to 'error' on
  // a load/init failure so we never leave a blank canvas behind. 'ready' once the
  // map's `load` fired — marker effects gate on it.
  const [status, setStatus] = useState<'pending' | 'ready' | 'error'>('pending');

  // Live MapLibre handles, kept across re-renders. Markers are tracked per kind
  // so each effect only churns its own layer. The refs live here (not in the
  // per-layer hooks) so the map-teardown cleanup below can reset them all in one
  // place, preserving the exact recreate behaviour.
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);
  const glRef = useRef<MapLibre | null>(null);
  const mpMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const stageMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const amenityMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const zoneLabelMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const peerMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  // SOS markers keyed by raiser userId (one per active SOS) + a framed-once set
  // so each new SOS flies/opens exactly once on first appearance.
  const sosMarkersRef = useRef<Map<string, import('maplibre-gl').Marker>>(new Map());
  const sosFramedRef = useRef<Set<string>>(new Set());
  // Draft authoring dots (in-progress zone vertices / site-plan corners).
  const draftMarkersRef = useRef<import('maplibre-gl').Marker[]>([]);
  const fittedRef = useRef(false);

  // ── Pursue / filter / nearest state (Phase 2B) ─────────────────────────────
  // The current pursue target (a peer, the SOS, or a nearest-amenity pin) or null.
  const [pursue, setPursue] = useState<PursueTarget | null>(() => sosPursueTarget(focusSosUserId));
  useEffect(() => {
    if (focusSosUserId) setPursue(sosPursueTarget(focusSosUserId));
  }, [focusSosUserId]);
  // Hidden amenity categories — toggled off via the filter chips. Default: all
  // shown (empty set). Component-local only, never persisted to the backend.
  const [hiddenAmenities, setHiddenAmenities] = useState<Set<AmenityType>>(() => new Set());
  // Place card + Nearest state. The card and the pursue bar share one slot.
  const interactive = !authoring;
  const [place, setPlace] = useState<MapPlace | null>(null);
  const [pendingNearest, setPendingNearest] = useState<AmenityType | null>(null);
  const [nearestNotice, setNearestNotice] = useState<{ kind: 'missing'; type: AmenityType } | null>(null);

  // Select (or toggle off) a pursue target. Stable identity so the marker
  // effects don't re-run just because this changed.
  const selectPursue = useCallback((next: PursueTarget) => {
    setPursue((prev) => (prev && prev.id === next.id ? null : next));
    setPlace(null);
  }, []);
  const clearPursue = useCallback(() => setPursue(null), []);

  // Browser geolocation watch — the user's own GPS fix for pursue / nearest-X.
  const { selfCoord, accuracyM, geoState, enableLocation, retryLocation } = useGeolocationWatch();
  // A weak signal or a blocked prompt needs a fresh watch; otherwise just start one.
  const locate = useCallback(() => {
    if (geoState === 'unavailable' || geoState === 'denied') retryLocation();
    else enableLocation();
  }, [geoState, retryLocation, enableLocation]);

  const pins = useMemo<Pin[]>(
    () => extractMeetingPointPins(meetingPoints as unknown as CrewMeetingPoint[]),
    [meetingPoints],
  );
  // Stage + amenity pins from the festival's map data (Phase A/B contract).
  // Empty for festivals that were never mapped — the "not mapped yet" note stays.
  const stagePins = useMemo<Pin[]>(() => extractStagePins(festival), [festival]);
  const amenityPins = useMemo<Pin[]>(() => extractAmenityPins(festival?.mapConfig), [festival]);
  // Zone polygons (Phase 4A): filled translucent areas (camping/VIP/no-go) drawn
  // UNDER the pins. Empty for festivals with no zones — no zone layer is added.
  const zones = useMemo(() => extractZones(festival?.mapConfig), [festival]);
  // Site-plan raster overlay (Phase 4B): the organizer's georeferenced paper map,
  // drawn UNDER zones + pins. Null for festivals with no site plan — no raster
  // layer is added (graceful, unchanged).
  const siteplan = useMemo(() => extractSiteplan(festival?.mapConfig), [festival]);
  // Amenity pins after the filter chips: a category in `hiddenAmenities` is
  // dropped from the rendered set. The full `amenityPins` is still used for the
  // camera + nearest-X search (so "nearest medical" works even when hidden).
  const visibleAmenityPins = useMemo<Pin[]>(
    () => amenityPins.filter((p) => !(p.amenityType && hiddenAmenities.has(p.amenityType))),
    [amenityPins, hiddenAmenities],
  );
  // Effective SOS list: prefer the multi-SOS `activeSosList`, else the single
  // `sos` prop (back-compat). A marker is rendered for EACH entry below.
  const sosList = useMemo<SosEntry[]>(() => activeSosList ?? (sos ? [sos] : []), [activeSosList, sos]);
  const hasPins = pins.length > 0;
  const hasStages = stagePins.length > 0;
  const hasAmenities = amenityPins.length > 0;
  const hasZones = zones.length > 0;
  const hasSiteplan = !!siteplan;
  const hasPeers = peers.length > 0;
  const hasSos = sosList.some((s) => !!s.position);
  // A festival camera alone (map-config bounds/center or the geocoded venue) is
  // enough: an unmapped festival still opens on its grounds, and the admin editor
  // gets a canvas for the first pin.
  const hasCamera = useMemo(() => pickFestivalCamera(festival, []).center != null, [festival]);
  // Render the map when there's ANYTHING to plot (meeting points, stage/amenity
  // map data, zone polygons, a site-plan overlay, live peers, an SOS coord) or a
  // known place to centre on.
  const shouldRenderMap =
    authoring || hasPins || hasStages || hasAmenities || hasZones || hasSiteplan || hasPeers || hasSos || hasCamera;

  // Initial camera: prefer the festival's explicit map-config (bounds/center),
  // then fall back to framing the static pins (meeting points + stages +
  // amenities), then live peers / SOS. pickFestivalCamera owns the static-pin
  // precedence; we extend its fallback with the ephemeral peer/SOS coord.
  // Zone centroids feed the camera-fit fallback as pseudo-pins so a zones-only
  // festival still frames its grounds (pickFestivalCamera's explicit config
  // bounds/center still win when present).
  const zoneCentroidPins = useMemo<Pin[]>(
    () =>
      zones
        .filter((z) => z.centroid)
        .map((z) => ({
          id: `zone:${z.id}`,
          kind: 'amenity' as const,
          label: z.label || 'Zone',
          latitude: z.centroid!.latitude,
          longitude: z.centroid!.longitude,
        })),
    [zones],
  );
  const staticPins = useMemo(
    () => [...pins, ...stagePins, ...amenityPins, ...zoneCentroidPins],
    [pins, stagePins, amenityPins, zoneCentroidPins],
  );
  const camera = useMemo(() => pickFestivalCamera(festival, staticPins), [festival, staticPins]);
  const center = useMemo(() => {
    if (camera.center) return camera.center;
    if (peers[0]) return { latitude: peers[0].lat, longitude: peers[0].lng };
    const sp = sosList.find((s) => s.position)?.position;
    if (sp) return { latitude: sp.lat, longitude: sp.lng };
    return null;
  }, [camera, peers, sosList]);

  // Stable keys so marker effects re-run only when their own coords change.
  const pinsKey = useMemo(() => pins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'), [pins]);
  const stagesKey = useMemo(
    () => stagePins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.color ?? ''}`).join('|'),
    [stagePins],
  );
  // Keyed off the VISIBLE set so toggling a chip re-runs the amenity marker
  // effect (hide/show), while the camera-fit effect keys off the full set below.
  const amenitiesKey = useMemo(
    () => visibleAmenityPins.map((p) => `${p.id}:${p.latitude},${p.longitude}:${p.amenityType ?? ''}`).join('|'),
    [visibleAmenityPins],
  );
  const allAmenitiesKey = useMemo(
    () => amenityPins.map((p) => `${p.id}:${p.latitude},${p.longitude}`).join('|'),
    [amenityPins],
  );
  // Re-run the zone effect when a zone's color/label/geometry changes (the
  // centroid + per-ring point counts capture a live admin draw adding vertices).
  const zonesKey = useMemo(
    () =>
      zones
        .map(
          (z) =>
            `${z.id}:${z.color}:${z.label}:${z.rings.map((r) => r.length).join(',')}:${z.centroid?.latitude ?? ''},${z.centroid?.longitude ?? ''}`,
        )
        .join('|'),
    [zones],
  );
  const peersKey = useMemo(() => peers.map((p) => `${p.userId}:${p.lat},${p.lng}:${p.serverAt}`).join('|'), [peers]);
  // SOS keys are SPLIT: the IDENTITY set (which raisers have a plotted SOS) drives
  // the build/reconcile + one-shot fly/open per new SOS, while the COORD set only
  // repositions the existing markers (no re-fly/re-open every tick). Keying the
  // build effect on lat/lng would yank the camera + reopen the popup on every tick.
  const sosIdsKey = useMemo(() => sosList.filter((s) => s.position).map((s) => s.userId).join('|'), [sosList]);
  const sosCoordsKey = useMemo(
    () => sosList.map((s) => (s.position ? `${s.userId}:${s.position.lat},${s.position.lng}` : '')).join('|'),
    [sosList],
  );
  // Draft authoring dots re-render only when a vertex/corner is added/removed/moved.
  const draftPointsKey = useMemo(
    () => (draftPoints ?? []).map((p) => `${p.latitude},${p.longitude}`).join('|'),
    [draftPoints],
  );
  // Re-run the site-plan effect when the image URL, corners, or opacity change.
  const siteplanKey = siteplan
    ? `${siteplan.imageUrl}:${siteplan.corners.map((c) => c.join(',')).join('|')}:${siteplan.opacity}`
    : '';

  // Resolve the pursue target's LIVE coord: a peer/SOS target tracks the latest
  // position from props (so the arrow follows them), while a nearest-amenity
  // target is static (uses its captured coord). Returns null if the target
  // vanished (e.g. the peer stopped sharing) so the overlay clears itself.
  const liveTarget = useMemo<PursueTarget | null>(() => {
    if (!pursue) return null;
    if (pursue.id.startsWith('peer:')) {
      const uid = pursue.id.slice('peer:'.length);
      const p = peers.find((x) => x.userId === uid);
      if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
      return { id: pursue.id, label: p.username || pursue.label, coord: { latitude: p.lat, longitude: p.lng } };
    }
    if (pursue.id.startsWith('sos:')) {
      const uid = pursue.id.slice('sos:'.length);
      const s = sosList.find((x) => x.userId === uid);
      if (!s?.position) return null;
      return {
        id: pursue.id,
        label: `${s.username} — SOS`,
        coord: { latitude: s.position.lat, longitude: s.position.lng },
      };
    }
    return pursue; // nearest-amenity: static captured coord
  }, [pursue, peers, sosList]);

  // The pursuit bundle (bearing + distance + compass + ETA) self → target.
  // Recomputed whenever self GPS or the target's live coord changes.
  const pursuit = useMemo(
    () => (selfCoord && liveTarget ? buildPursuit(selfCoord, liveTarget.coord) : null),
    [selfCoord, liveTarget],
  );

  // Tapping a marker opens its place card. Remember the marker so closing the card
  // can return focus to it.
  const openerRef = useRef<HTMLElement | null>(null);
  const selectPlace = useCallback((pin: Pin) => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setPlace(placeFromPin(pin));
    setPursue(null);
  }, []);
  const closePlace = useCallback(() => {
    setPlace(null);
    const opener = openerRef.current;
    (opener?.isConnected ? opener : containerRef.current)?.focus();
  }, []);

  // "Nearest X": find the closest amenity of a category to self and show the way.
  // Searches the FULL amenity set (ignores filter visibility) so "nearest medical"
  // works when medical is toggled off. With no fix it asks for one and finishes
  // when the fix arrives (see the effect below).
  const applyNearestStep = useCallback(
    (step: NearestStep) => {
      if (step.kind === 'missing') {
        setNearestNotice({ kind: 'missing', type: step.type });
        setPendingNearest(null);
        return;
      }
      if (step.kind === 'need-fix') {
        if (selfCoord) return; // a fix exists but no pin is reachable: nothing to wait for
        setNearestNotice(null);
        setPendingNearest(step.type);
        locate();
        return;
      }
      setPursue(nearestTarget(step));
      setPlace(null);
      setNearestNotice(null);
      setPendingNearest(null);
      mapRef.current?.flyTo({ center: [step.pin.longitude, step.pin.latitude], zoom: 16, duration: 600 });
    },
    [selfCoord, locate],
  );
  const pursueNearest = useCallback(
    (type: AmenityType) => applyNearestStep(nearestStep(type, amenityPins, selfCoord)),
    [applyNearestStep, amenityPins, selfCoord],
  );
  useEffect(() => {
    if (!selfCoord || !pendingNearest) return;
    const type = pendingNearest;
    setPendingNearest(null);
    applyNearestStep(nearestStep(type, amenityPins, selfCoord));
  }, [selfCoord, pendingNearest, amenityPins, applyNearestStep]);

  // "Show my location": fly to the fix now, or ask for one and fly when it lands.
  const flyToSelfRef = useRef(false);
  const showMyLocation = useCallback(() => {
    if (selfCoord) {
      mapRef.current?.flyTo({ center: [selfCoord.longitude, selfCoord.latitude], zoom: 16, duration: 600 });
      return;
    }
    flyToSelfRef.current = true;
    locate();
  }, [selfCoord, locate]);
  useEffect(() => {
    if (!flyToSelfRef.current || !selfCoord) return;
    flyToSelfRef.current = false;
    mapRef.current?.flyTo({ center: [selfCoord.longitude, selfCoord.latitude], zoom: 16, duration: 600 });
  }, [selfCoord]);

  // Close the card when its pin is gone (stage deleted, festival or crew changed).
  // A filtered-out amenity keeps its card: the check uses the full pin list.
  const allPinsKey = [pinsKey, stagesKey, allAmenitiesKey].join('|');
  const allPinsRef = useRef<Pin[]>([]);
  allPinsRef.current = [...pins, ...stagePins, ...amenityPins];
  useEffect(() => {
    if (place && !findMapPin(place.kind, place.id, allPinsRef.current)) setPlace(null);
  }, [place, allPinsKey]);
  // Authoring turns the map non-interactive: drop everything that needs a tap.
  useEffect(() => {
    if (interactive) return;
    setPlace(null);
    setPendingNearest(null);
    setNearestNotice(null);
  }, [interactive]);
  const festivalId = festival?.id;
  useEffect(() => {
    setPlace(null);
    setPendingNearest(null);
    setNearestNotice(null);
  }, [festivalId]);

  // Keep the latest camera for the lazy map creation without making it an effect
  // dep (which would recreate the map on every position tick).
  const centerRef = useRef(center);
  centerRef.current = center;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  // Keep the latest authoring click handler in a ref so the map's click listener
  // (wired once at creation) always calls the current callback without making the
  // handler a map-creation dep (which would recreate the map on every render).
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  // Latest festival map-config for the lazy map creation (style choice), without
  // making it a creation dep. The style is picked once at map creation.
  const mapConfigRef = useRef(festival?.mapConfig);
  mapConfigRef.current = festival?.mapConfig;
  // The online basemap follows the theme, so a theme change rebuilds the map and
  // the per-concern hooks re-add their layers when it reports ready again.
  const theme = useUIStore((s) => s.theme);

  // ── Map lifecycle: create once when there's content; tear down on unmount ──
  useEffect(() => {
    if (!shouldRenderMap || !containerRef.current) return;
    if (mapRef.current) return; // already created
    let cancelled = false;

    (async () => {
      try {
        const maplibregl = await import('maplibre-gl');
        await import('maplibre-gl/dist/maplibre-gl.css');
        // v6 resolves its worker at runtime from `import.meta.url`, which no
        // bundler can see — so nothing emits the worker and every vector/GeoJSON
        // source silently renders nothing. Hand Vite the worker entry explicitly
        // (`?worker&url` bundles it, following its own shared-chunk import) and
        // point maplibre at the emitted asset. Idempotent, so no once-guard.
        const { default: workerUrl } = await import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url');
        maplibregl.setWorkerUrl(workerUrl);

        const cfg = mapConfigRef.current;
        // Phase 3A: only when this festival carries a valid offline basemap do we
        // register the pmtiles protocol + read it from a vector style. Otherwise
        // pickMapStyle returns the themed online OpenFreeMap style. addProtocol is a
        // process-global registration; the module-level flag guards repeated map
        // mounts from double-registering (maplibre warns on a duplicate). The
        // flag lives on this module because maplibre-gl v6 is ESM-only and its
        // import namespace object is frozen — it cannot carry the marker. Done
        // BEFORE the final mounted-guard so no await sits between that guard and
        // the mapRef assignment (keeps the atomic-update lint happy).
        if (hasOfflineBasemap(cfg)) {
          // The latch is installed synchronously, so a second mount that reaches
          // here before the import settles joins this attempt instead of starting
          // its own. On failure it clears itself: in this offline-first PWA the
          // usual failure is the pmtiles chunk missing from the service-worker
          // cache, and a permanently claimed latch would silently skip
          // registration for every later mount, leaving the vector basemap dead
          // until a full reload.
          pmtilesRegistration ??= (async () => {
            const { Protocol } = await import('pmtiles');
            maplibregl.addProtocol('pmtiles', new Protocol().tile);
          })().catch((err: unknown) => {
            pmtilesRegistration = null;
            throw err;
          });
          await pmtilesRegistration;
        }
        if (cancelled || !containerRef.current || mapRef.current) return;

        const c = centerRef.current;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: pickMapStyle(cfg, theme) as unknown as import('maplibre-gl').StyleSpecification,
          center: c ? [c.longitude, c.latitude] : [0, 0],
          zoom: c ? 14 : 1,
          attributionControl: { compact: true },
          // North-locked: the pursue arrow + heading carets are north-referenced,
          // so disable rotation/pitch — a rotated basemap would desync them.
          dragRotate: false,
          pitchWithRotate: false,
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        // Also kill two-finger / keyboard rotation (not covered by dragRotate).
        try {
          map.touchZoomRotate?.disableRotation?.();
          map.keyboard?.disableRotation?.();
        } catch {
          // Older GL builds may lack these handlers — never fatal.
        }
        map.on('error', () => {
          if (!cancelled) setStatus('error');
        });
        map.on('load', () => {
          if (cancelled) return;
          setStatus('ready');
        });
        // Authoring: report each map click's coord to the current handler (if
        // any). Wired once; the ref keeps it pointing at the latest callback.
        map.on('click', (e) => {
          const cb = onMapClickRef.current;
          if (!cb) return;
          const { lng, lat } = e.lngLat;
          if (Number.isFinite(lat) && Number.isFinite(lng)) cb({ latitude: lat, longitude: lng });
        });
        glRef.current = maplibregl;
        mapRef.current = map;
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      mpMarkersRef.current = [];
      stageMarkersRef.current = [];
      amenityMarkersRef.current = [];
      zoneLabelMarkersRef.current = [];
      peerMarkersRef.current = [];
      sosMarkersRef.current = new Map();
      sosFramedRef.current = new Set();
      draftMarkersRef.current = [];
      fittedRef.current = false;
      mapRef.current?.remove();
      mapRef.current = null;
      glRef.current = null;
      setStatus('pending');
    };
    // Only (re)create when content first appears / disappears or the theme
    // changes the basemap. The refs read inside are intentionally not deps.
  }, [shouldRenderMap, theme]);

  // ── Per-concern layers (each keys its own effect on a stable content string,
  //    reads its live data through a ref → honest deps, no suppressions). ──────
  useSiteplanLayer(mapRef, glRef, status, siteplan, siteplanKey);
  useZoneLayer(mapRef, glRef, status, zones, zonesKey, zoneLabelMarkersRef);
  const onSelectPlace = interactive ? selectPlace : undefined;
  useMeetingPointMarkers(mapRef, glRef, status, pins, pinsKey, mpMarkersRef, onSelectPlace);
  useStageMarkers(mapRef, glRef, status, stagePins, stagesKey, stageMarkersRef, onSelectPlace);
  useAmenityMarkers(mapRef, glRef, status, visibleAmenityPins, amenitiesKey, amenityMarkersRef, onSelectPlace);
  usePeerMarkers(mapRef, glRef, status, peers, peersKey, peerMarkersRef, selectPursue);
  useSosMarkers(mapRef, glRef, status, sosList, sosIdsKey, sosCoordsKey, sosMarkersRef, sosFramedRef, selectPursue);
  useSelfMarker(mapRef, glRef, status, selfCoord, accuracyM, interactive);
  useDraftMarkers(mapRef, glRef, status, draftPoints, draftPointsKey, draftMarkersRef);
  useMapFraming(
    mapRef,
    glRef,
    status,
    { pins, stagePins, amenityPins, zones, siteplan, peers, sosList },
    { pinsKey, stagesKey, allAmenitiesKey, zonesKey, siteplanKey, peersKey, sosIdsKey },
    cameraRef,
    fittedRef,
  );

  // Fly to a stage and open its card when the route asks. It runs after the first
  // fit so the fit does not undo it; the ref stops a re-run from re-focusing.
  const focusedRef = useRef<string | null>(null);
  const stagePinsRef = useRef(stagePins);
  stagePinsRef.current = stagePins;
  const onFocusHandledRef = useRef(onFocusHandled);
  onFocusHandledRef.current = onFocusHandled;
  useEffect(() => {
    if (!focusPinId) {
      focusedRef.current = null;
      return;
    }
    if (status !== 'ready' || !interactive || focusedRef.current === focusPinId) return;
    const pin = findMapPin('stage', focusPinId, stagePinsRef.current);
    if (!pin) return;
    focusedRef.current = focusPinId;
    mapRef.current?.flyTo({ center: [pin.longitude, pin.latitude], zoom: 17, duration: 600 });
    selectPlace(pin);
    onFocusHandledRef.current?.();
  }, [status, focusPinId, stagesKey, interactive, selectPlace]);

  // ── Empty state: nothing to plot ───────────────────────────────────────────
  if (!shouldRenderMap) {
    return (
      <div className="px-1">
        <EmptyState
          icon={<MapPin className="w-12 h-12" aria-hidden="true" />}
          title="No mapped meeting points yet"
          description="Add a location to a meeting point to see it here."
        />
        {!hasStages && !hasAmenities && (
          <p className="text-xs text-text-muted text-center mt-2">This festival isn&apos;t mapped yet.</p>
        )}
      </div>
    );
  }

  const peerCount = peers.length;
  const countCopy = [
    pins.length ? (pins.length === 1 ? '1 mapped point' : `${pins.length} mapped points`) : '',
    stagePins.length ? (stagePins.length === 1 ? '1 stage' : `${stagePins.length} stages`) : '',
    amenityPins.length ? (amenityPins.length === 1 ? '1 amenity' : `${amenityPins.length} amenities`) : '',
    peerCount ? (peerCount === 1 ? '1 live crew member' : `${peerCount} live crew members`) : '',
  ]
    .filter(Boolean)
    .join(' · ');

  // Pursue is SOS-flavored (coral) only for the SOS target; peers + amenities
  // use the aqua selection accent.
  const pursueIsSos = !!liveTarget && liveTarget.id.startsWith('sos:');
  const showPlaceCard = interactive && !!place && status === 'ready';
  const showPursueOverlay = status === 'ready' && !!liveTarget && !showPlaceCard;

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg overflow-hidden border border-border bg-bg-secondary">
        <div
          ref={containerRef}
          className={`festie-map-canvas ${canvasClassName} w-full`}
          role="region"
          tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- intentional: focus enables arrow-key map pan/zoom (see aria-describedby help below); rule only exempts role=tabpanel
          aria-label="Crew map with meeting points and live locations"
          aria-describedby="festie-map-help"
        />
        <p id="festie-map-help" className="sr-only">
          Interactive map. Use Tab to reach map markers, then Enter or Space to open one. Tap a crew member, stage,
          amenity or meeting point to see what it is and how far it is. Choose Show the way for a direction arrow,
          distance and walking time. While the map is focused, use the arrow keys to pan and the plus and minus keys to
          zoom. The List view shows every meeting point and is fully keyboard accessible.
        </p>
        {status === 'pending' && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-text-secondary bg-bg-secondary/80">
            Loading map…
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center bg-bg-secondary">
            <AlertTriangle className="w-8 h-8 text-accent-amber" aria-hidden="true" />
            <p className="text-sm text-text-secondary">
              Map needs signal to load. Your pinned points are still listed below.
            </p>
          </div>
        )}

        {interactive && status === 'ready' && (
          <button
            type="button"
            onClick={showMyLocation}
            className="absolute left-2 top-2 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full border border-border bg-bg-elevated/95 text-text-primary shadow-lg hover:border-accent-aqua"
            aria-label={MAP_COPY.showMyLocation}
          >
            <LocateFixed className="w-5 h-5" aria-hidden="true" />
          </button>
        )}

        {/* ── Place card: what a tapped pin is, how far, and what to do next. */}
        {showPlaceCard && place && (
          <PlaceCard
            place={place}
            selfCoord={selfCoord}
            geoState={geoState}
            onShowWay={() => {
              setPursue(placeTarget(place));
              setPlace(null);
            }}
            onSetMeetingPoint={onSetMeetingPoint}
            onLocate={locate}
            onClose={closePlace}
          />
        )}

        {/* ── Pursue overlay: directional arrow + label "Alex · 210 m NE · ~3 min". */}
        {showPursueOverlay && (
          <div
            className="absolute left-2 bottom-2 right-2 z-10 flex items-center gap-3 rounded-lg border bg-bg-elevated/95 px-3 py-2 shadow-lg"
            style={{ borderColor: pursueIsSos ? 'var(--color-accent-coral)' : 'var(--color-accent-aqua)' }}
            role="status"
            aria-live="polite"
          >
            {selfCoord && pursuit && Number.isFinite(pursuit.bearingDeg) ? (
              <Navigation
                className="w-7 h-7 shrink-0"
                aria-hidden="true"
                style={{
                  color: pursueIsSos ? 'var(--color-accent-coral)' : 'var(--color-accent-aqua)',
                  // lucide's Navigation glyph points NE (45°) at rotation 0, so
                  // subtract 45° so a due-north target points straight up.
                  transform: `rotate(${pursuit.bearingDeg - 45}deg)`,
                  transition: 'transform 300ms ease-out',
                }}
              />
            ) : (
              <Navigation className="w-7 h-7 shrink-0 text-text-muted opacity-50" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              {selfCoord && pursuit ? (
                <p className="truncate text-sm text-text-primary">
                  <span className="font-semibold">{liveTarget.label}</span>
                  <span className="text-text-secondary">
                    {' · '}
                    {pursuit.distanceLabel}
                    {pursuit.compass ? ` ${pursuit.compass}` : ''}
                    {pursuit.etaLabel !== '—' ? ` · ~${pursuit.etaLabel}` : ''}
                  </span>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={locate}
                  className="text-left text-sm text-accent-aqua underline-offset-2 hover:underline"
                >
                  {locationPromptCopy(geoState, liveTarget.label)}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={clearPursue}
              className="shrink-0 rounded p-1 min-h-11 min-w-11 inline-flex items-center justify-center text-text-muted hover:text-text-primary"
              aria-label={MAP_COPY.stopShowingWay}
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* ── Nearest-X quick controls: show the way to the closest medical / water / toilet. */}
      {hasAmenities && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-text-muted">{MAP_COPY.nearest}</span>
          {NEAREST_AMENITY_TYPES.map((type) => {
            const { glyph } = amenityGlyph(type);
            const name = humanizeAmenityType(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => pursueNearest(type)}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-secondary px-2.5 py-1 min-h-11 text-xs text-text-secondary hover:border-accent-aqua hover:text-text-primary"
                aria-label={`Show the way to the nearest ${name.toLowerCase()}`}
              >
                <span aria-hidden="true">{glyph}</span>
                {name}
              </button>
            );
          })}
        </div>
      )}
      {interactive && nearestNotice?.kind === 'missing' && (
        <p role="status" className="text-xs text-text-secondary">
          {nearestMissingCopy(nearestNotice.type)}
          {nearestNotice.type === 'medical' && (
            <>
              {' '}
              <a href="tel:911" className="text-accent-aqua underline">
                {MAP_COPY.call911}
              </a>
            </>
          )}
        </p>
      )}
      {interactive && !nearestNotice && pendingNearest && (
        <p role="status" className="text-xs text-text-secondary">
          {geoState === 'denied' || geoState === 'unavailable' ? (
            <>
              {locationPromptCopy(geoState)}{' '}
              <button type="button" onClick={retryLocation} className="text-accent-aqua underline">
                {MAP_COPY.tryAgain}
              </button>
            </>
          ) : (
            locationPromptCopy('locating')
          )}
        </p>
      )}

      {/* ── Amenity filter chips: toggle each category on/off (local only). */}
      {hasAmenities && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter amenities by category">
          {MAP_AMENITY_CATEGORIES.filter((type) => amenityPins.some((p) => p.amenityType === type)).map((type) => {
            const { glyph } = amenityGlyph(type);
            const name = humanizeAmenityType(type);
            const on = !hiddenAmenities.has(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() =>
                  setHiddenAmenities((prev) => {
                    const next = new Set(prev);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                aria-pressed={on}
                aria-label={`${on ? 'Hide' : 'Show'} ${name}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 min-h-11 text-xs ${
                  on
                    ? 'border-accent-aqua bg-accent-aqua/10 text-text-primary'
                    : 'border-border bg-bg-secondary text-text-muted'
                }`}
              >
                <span aria-hidden="true" className={on ? '' : 'opacity-40'}>
                  {glyph}
                </span>
                {name}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-xs text-text-muted text-center">
        {countCopy || (authoring ? 'Click Set location, then click the map.' : 'Live locations')}
        {!hasStages && !hasAmenities && pins.length > 0 ? ' · this festival isn’t mapped yet' : ''}
      </p>
    </div>
  );
}
