import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { router, useFocusEffect } from 'expo-router';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { Ionicons } from '@expo/vector-icons';
import {
  extractMeetingPointPins,
  extractStagePins,
  extractAmenityPins,
  extractZones,
  zonesGeoJSON,
  zoneLabels,
  extractSiteplan,
  siteplanImageSource,
  amenityGlyph,
  pickFestivalCamera,
  formatStaleness,
  isPeerStale,
  headingToArrow,
  formatBatteryLabel,
  formatShareWindow,
  getInitials,
  buildPursuit,
  pickMapStyle,
  OPENFREEMAP_HOST,
  pmtilesHost,
  hasOfflineBasemap,
  pmtilesVectorStyle,
  MAP_AMENITY_CATEGORIES,
  NEAREST_AMENITY_TYPES,
  MAP_COPY,
  humanizeAmenityType,
  nearestStep,
  nearestTarget,
  nearestMissingCopy,
  placeFromPin,
  placeTarget,
  findMapPin,
  showingWayLabel,
  locationPromptCopy,
  nearStageName,
  type Coord,
  type GeoState,
  type MapPlace,
  type MapPin as Pin,
} from '@festie/shared/utils';
import type { CrewMeetingPoint, PeerLocation, SosEntry, Festival, Stage, AmenityType } from '@festie/shared/types';
import { useFestivalModeStore, useUIStore } from '@festie/shared/stores';
import { FIND_FRIEND_COPY } from '@festie/shared/constants';
import { useTokens, makeStyles, typeStyle, iconSize, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import { useNow } from '../hooks/useNow';
import { safeJsonForScript, isAllowedMapHost, buildSetAuthoringScript } from '../lib/webviewBridge';
import type { AuthoringMode } from '../lib/webviewBridge';
import { basemapCacheInfo, ensureBasemapCached, readCachedBase64 } from '../lib/basemapCache';
import { buildMapHtml } from '../lib/mapDocument';
import { peerCompassHref } from '../lib/dayOfRoutes';
import Button from './Button';
import MapPlaceCard from './MapPlaceCard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A static festival map-data marker (stage or amenity) pushed into the WebView
 * via window.__festieSetMapData. Glyph + color are resolved on the RN side from
 * the shared `amenityGlyph` map (single source of truth) so the inline document
 * needs no category logic of its own.
 */
interface MapMarker {
  id: string;
  kind: 'stage' | 'amenity';
  label: string;
  latitude: number;
  longitude: number;
  /** Fill color: stage brand color, or the amenity category color. */
  color: string;
  /** Emoji glyph for amenities; empty for stages (which show a label tag). */
  glyph?: string;
}

/** A peer/SOS marker pushed into the WebView via window.__festieSetPeers. */
interface LivePin {
  id: string;
  label: string;
  sublabel?: string;
  initial: string;
  latitude: number;
  longitude: number;
  kind: 'peer' | 'sos';
  /** Peer's last fix has aged past the freshness window (desaturate + chip). */
  stale?: boolean;
  /** Short "N ago" age shown on the stale chip (no "as of" prefix). */
  age?: string;
  /** Phase 4C: GPS course (deg) — rotates the direction-of-travel caret. */
  heading?: number;
  /** Phase 4C: 8-wind arrow glyph for the popup ("Heading ↗"); absent when no heading. */
  headingArrow?: string;
  /** Phase 4C: battery chip text ("8% — regroup"); absent when no battery data. */
  batteryLabel?: string;
  /** Peer low-power flag (#5): sharer is in battery-saver mode — shows a "Low Power" cue next to battery. */
  lowPower?: boolean;
  /** Phase 4C: share-window countdown ("sharing ends in Nm"); absent when no expiry. */
  windowLabel?: string;
}

/**
 * OfflineMap — M6 offline map via WebView (lowest native risk: react-native-webview
 * is already a dep, no native maps module added).
 *
 * The WebView hosts MapLibre GL JS. The runtime (MapLibre's script + stylesheet
 * and the PMTiles UMD) is VENDORED INTO THE APP and inlined into the document by
 * lib/mapDocument.ts — it used to come from unpkg.com on every map open, so the
 * map now starts with no network and no third-party origin at all. Meeting-point
 * pins (F4 coords) are passed RN -> WebView via postMessage and rendered as
 * markers.
 *
 * OFFLINE-HONEST: vendoring the runtime does NOT make the map work offline on its
 * own — TILES are a separate problem. A festival with an offline PMTiles archive
 * cached to device (lib/basemapCache.ts) now renders a fully interactive map with
 * zero network. Every other festival still needs signal for its OpenStreetMap
 * raster tiles, so when we are offline WITHOUT a cached archive we DO NOT show a
 * blank WebView with pins floating on nothing: `canRenderMap` (below) keeps us on
 * the graceful fallback list of the same pins + the honest copy "map needs the
 * festival downloaded for offline". This component never implies a live map is
 * available with no signal.
 *
 * TRUE-OFFLINE TODO (F5): the MapLibre half is done; what remains is the TILE
 * ARCHIVE. Only a festival whose mapConfig carries an `offlineBasemap.pmtilesUrl`
 * can be cached, and only after one online open. Getting an archive to every
 * festival (authoring/hosting the .pmtiles, plus a "download this festival" flow)
 * is still open. Until then the fallback list is the offline path for festivals
 * with no archive.
 */

// Origins the inline map document is allowed to load/navigate to. The page is
// served as inline HTML (about:blank origin) and, now that the MapLibre runtime
// is vendored into the app, pulls nothing but the OpenFreeMap basemap.
// Narrowed off the old ['*'] so the WebView can't be navigated to an arbitrary
// attacker origin (security-review H3 / I4).
const MAP_ORIGIN_WHITELIST = [
  'about:',
  `https://${OPENFREEMAP_HOST}`,
];

/**
 * Default-DENY navigation guard FACTORY. Allows the inline document's own load
 * (about:blank / data:) and resource loads from the map's CDN + tile hosts;
 * blocks every other origin so an injected payload cannot redirect the WebView
 * off to an attacker host. The map never legitimately navigates elsewhere.
 *
 * Phase 3A: `extraHost` is the ONE additional https host permitted — the current
 * festival's PMTiles archive host (config-driven, validated https upstream).
 * Passing it through the closure keeps the allowlist exactly as wide as the
 * active festival needs and no wider; with no offline basemap it's null and the
 * guard is byte-for-byte the prior behaviour.
 *
 * `file://` is always rejected: a saved archive reaches the document as bytes.
 */
function makeShouldStartLoad(extraHost: string | string[] | null) {
  return function onShouldStartLoadWithRequest(req: ShouldStartLoadRequest): boolean {
    const url = req.url || '';
    // The inline HTML document itself (no real origin) + data URIs MapLibre uses.
    if (url === 'about:blank' || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return true;
    }
    if (url.startsWith('file://')) return false;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      return false;
    }
    return isAllowedMapHost(host, extraHost);
  };
}

// If the document hasn't signalled "ready" within this window we assume the
// WebView never came up (it no longer means "no CDN" — the runtime is inlined)
// and fall back to the list. Generous to tolerate a slow device.
const LOAD_TIMEOUT_MS = 8000;

// With no GPS fix this long after the watch starts, say the signal is weak
// (the watch stays alive, so a late fix still turns location on).
const NO_FIX_TIMEOUT_MS = 15_000;

interface OfflineMapProps {
  meetingPoints: CrewMeetingPoint[];
  /** Live crew peers currently sharing (ephemeral; from liveLocationStore). */
  peers?: PeerLocation[];
  /**
   * Active crew SOS, if any (ephemeral; from liveLocationStore). Back-compat
   * single-SOS input — superseded by `activeSosList` when that's provided.
   */
  sos?: SosEntry | null;
  /**
   * All currently-active crew SOS (newest first), from the store's
   * `activeSosList`. When provided it supersedes `sos` and a marker is rendered
   * for EACH entry (each framed once on first appearance). Omitted ⇒ falls back
   * to `[sos]` so existing single-SOS callers are unchanged.
   */
  activeSosList?: SosEntry[];
  /**
   * Tap-to-create: fired when the user long-presses the interactive map, with
   * the pressed coordinate. The screen wires this to the existing meeting-point
   * create flow (prefilled with these coords). Omit to disable the affordance.
   */
  onMapPress?: (coord: { latitude: number; longitude: number }) => void;
  /**
   * Current festival carrying `mapConfig` (amenities + camera) and, when the
   * caller folds in the store's separate `stages` array, `stages[]`. Omitted/null
   * keeps the original behaviour + "not mapped yet" fallback. Backward-compatible.
   */
  festival?: (Festival & { stages?: Stage[] }) | null;
  /**
   * Authoring mode for the admin map editor (Phase D). 'off' (default) is the
   * normal crew-map behaviour. 'stage' / 'amenity' tint the map cursor so the
   * admin knows the next placement tap will set a stage location or drop an
   * amenity. The tap itself still flows through `onMapPress` (the existing
   * placement/`map-longpress` path) — authoring only annotates intent.
   */
  authoringMode?: AuthoringMode;
  /**
   * In-progress authoring vertices/corners (Phase 4A/4B). While the admin draws a
   * zone or places the 4 site-plan corners, each tapped point is pushed here so the
   * WebView renders a small dot at it — giving per-tap feedback BELOW the threshold
   * where the polygon/overlay can render (a 1–2-vertex zone or a 1–3-corner site
   * plan otherwise shows nothing on the map). Omitted/empty in normal crew use — no
   * dots drawn. Backward-compatible.
   */
  draftPoints?: { latitude: number; longitude: number }[];
  /**
   * Extra lift for the floating controls (add meeting point, recenter) when
   * something the map cannot see overlays its bottom edge, such as the iOS
   * native tab bar. Keeps them stacked above the caller's own SOS FAB.
   */
  bottomInset?: number;
  /** A stage pin id to fly to and open once the map is up (the Map tab's `focusStage`). */
  focusPinId?: string | null;
  /** Called once after `focusPinId` was handled, so the caller can clear its param. */
  onFocusHandled?: () => void;
  /** Shows "Set as meeting point" on the place card. Omit for guests and the admin editor. */
  onSetMeetingPoint?: (place: MapPlace) => void;
}

export default function OfflineMap({
  meetingPoints,
  peers,
  sos,
  activeSosList,
  onMapPress,
  festival = null,
  authoringMode = 'off',
  draftPoints,
  bottomInset = 0,
  focusPinId = null,
  onFocusHandled,
  onSetMeetingPoint,
}: OfflineMapProps) {
  const t = useTokens();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const bottomPad = useListBottomInset();
  const lowPowerMode = useFestivalModeStore((s) => s.lowPowerMode);
  // App-wide connectivity, driven from NetInfo by the root OfflineBanner. Used
  // only to decide whether a basemap is reachable at all (see canRenderMap).
  const offlineMode = useUIStore((s) => s.offlineMode);
  const theme = useUIStore((s) => s.theme);
  // react-native-webview 14 types the class as WebView<P = undefined>, which
  // collapses its props to `never`; pass `object` here and on the JSX tag.
  const webRef = useRef<WebView<object>>(null);
  // A "find me" tap waiting for the first GPS fix from the shared watch.
  const [pendingRecenter, setPendingRecenter] = useState(false);
  // Placement mode: when on, the next single map tap drops a meeting point at
  // that coord (replaces the unreliable long-press/contextmenu gesture). The
  // WebView confirms the actual on/off state back via the 'placement' message.
  const [placing, setPlacing] = useState(false);

  // ── Pursue / filter / nearest state (Phase 2B) ─────────────────────────────
  // The user's own GPS fix (expo-location watch), powering pursuit + nearest-X.
  const [selfCoord, setSelfCoord] = useState<Coord | null>(null);
  const [geoState, setGeoState] = useState<GeoState>('idle');
  // The current pursue target id ('peer:<uid>' | 'sos:<uid>' | 'amenity:<id>')
  // plus a captured label/coord. Peer/SOS targets re-resolve to live coords below.
  const [pursue, setPursue] = useState<{ id: string; label: string; coord: Coord } | null>(null);
  // Amenity categories toggled off via the filter chips (local only).
  const [hiddenAmenities, setHiddenAmenities] = useState<Set<AmenityType>>(() => new Set());
  // The open place card. It shares the top slot with the pursue bar: opening one clears the other.
  const [place, setPlace] = useState<MapPlace | null>(null);
  // A Nearest tap waiting for the first GPS fix, and the "none mapped" notice.
  const [pendingNearest, setPendingNearest] = useState<AmenityType | null>(null);
  const [nearestNotice, setNearestNotice] = useState<{ kind: 'missing'; type: AmenityType } | null>(null);
  // Place cards and Nearest are crew-map only: never while authoring or placing,
  // so a pin tap still reaches the placement click.
  const interactive = authoringMode === 'off' && !placing;

  const pins = useMemo(() => extractMeetingPointPins(meetingPoints), [meetingPoints]);
  // Stage + amenity pins from the festival's map data (Phase A/B contract).
  const stagePins = useMemo(() => extractStagePins(festival), [festival]);
  const amenityPins = useMemo(() => extractAmenityPins(festival?.mapConfig), [festival]);
  // Zone polygons (Phase 4A): filled translucent areas drawn UNDER the markers.
  const zones = useMemo(() => extractZones(festival?.mapConfig), [festival]);
  // Site-plan raster overlay (Phase 4B): the organizer's georeferenced paper map.
  const siteplan = useMemo(() => extractSiteplan(festival?.mapConfig), [festival]);
  const hasStages = stagePins.length > 0;
  const hasAmenities = amenityPins.length > 0;
  const hasZones = zones.length > 0;
  const hasSiteplan = !!siteplan;

  // Resolve stage + amenity pins into WebView markers, attaching glyph + color
  // from the shared source so the inline document carries no category logic.
  const mapMarkers = useMemo<MapMarker[]>(() => {
    const out: MapMarker[] = [];
    for (const s of stagePins) {
      out.push({
        id: s.id,
        kind: 'stage',
        label: s.label,
        latitude: s.latitude,
        longitude: s.longitude,
        color: s.color || '#19e3d3',
      });
    }
    for (const a of amenityPins) {
      // Filtered out by a chip toggle — skip rendering (still searchable for nearest-X).
      if (a.amenityType && hiddenAmenities.has(a.amenityType)) continue;
      const { glyph, color } = amenityGlyph(a.amenityType);
      out.push({
        id: a.id,
        kind: 'amenity',
        label: a.label,
        latitude: a.latitude,
        longitude: a.longitude,
        color,
        glyph,
      });
    }
    return out;
  }, [stagePins, amenityPins, hiddenAmenities]);

  // Zone centroids feed the camera fallback as pseudo-pins so a zones-only
  // festival still centres on its grounds (explicit config bounds/center win).
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

  // Initial camera: festival map-config (bounds/center) → static pins → centroid.
  const staticPins = useMemo(
    () => [...pins, ...stagePins, ...amenityPins, ...zoneCentroidPins],
    [pins, stagePins, amenityPins, zoneCentroidPins],
  );
  const camera = useMemo(() => pickFestivalCamera(festival, staticPins), [festival, staticPins]);
  const center = camera.center;

  // Effective SOS list: prefer the multi-SOS `activeSosList`, else the single
  // `sos` prop (back-compat). A marker is rendered for EACH entry.
  const sosList = useMemo<SosEntry[]>(() => activeSosList ?? (sos ? [sos] : []), [activeSosList, sos]);

  const hasLive = (peers?.length ?? 0) > 0 || sosList.length > 0;

  // Live peer + SOS markers pushed into the WebView (and listed in the fallback).
  // `now` ticks via useNow so staleness recomputes without an impure Date.now()
  // in the memo factory (react-hooks/purity).
  const now = useNow();
  const livePins = useMemo<LivePin[]>(() => {
    const items: LivePin[] = [];
    for (const p of peers ?? []) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      const age = formatStaleness(p.serverAt).replace(/^as of /, '');
      const stale = isPeerStale(p.serverAt, now);
      // Phase 4C: heading caret + battery + share-window. All formatted on the RN
      // side (shared pure helpers) and passed as plain strings/number so the
      // WebView document never computes them. Suppressed for stale peers.
      const arrow = stale ? null : headingToArrow(p.heading);
      const battery = stale ? null : formatBatteryLabel(p.battery);
      // Peer low-power flag (#5): only cue a live (non-stale) peer in battery-saver mode.
      const lowPower = stale ? false : p.lowPower === true;
      const windowLabel = stale ? null : formatShareWindow(p.expiresAt, now);
      const near = nearStageName({ latitude: p.lat, longitude: p.lng }, stagePins);
      const base = stale ? `last seen ${age}` : `live · ${age}`;
      items.push({
        id: `peer:${p.userId}`,
        label: p.username || 'Crew member',
        sublabel: near ? `${base} · ${FIND_FRIEND_COPY.nearStage(near)}` : base,
        initial: getInitials(p.username ?? '') || '?',
        latitude: p.lat,
        longitude: p.lng,
        kind: 'peer',
        stale,
        age,
        ...(arrow && typeof p.heading === 'number' ? { heading: p.heading, headingArrow: arrow } : {}),
        ...(battery ? { batteryLabel: battery } : {}),
        ...(lowPower ? { lowPower: true } : {}),
        ...(windowLabel ? { windowLabel } : {}),
      });
    }
    for (const s of sosList) {
      if (s.position && Number.isFinite(s.position.lat) && Number.isFinite(s.position.lng)) {
        items.push({
          id: `sos:${s.userId}`,
          label: `${s.username} — SOS`,
          sublabel: s.message || 'Needs help',
          initial: '!',
          latitude: s.position.lat,
          longitude: s.position.lng,
          kind: 'sos',
        });
      }
    }
    return items;
  }, [peers, sosList, now, stagePins]);

  // Meeting points present but without coords — listed so they're never lost,
  // even though they can't be plotted.
  const uncoordedPoints = useMemo(
    () =>
      (meetingPoints ?? []).filter(
        (p) => p && p.active !== false && !(Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
      ),
    [meetingPoints],
  );

  // Resolve the pursue target's LIVE coord: peer/SOS targets track the latest
  // position from props (so the arrow follows them); a nearest-amenity target is
  // static. Null when the target vanished (peer stopped sharing) → overlay clears.
  const liveTarget = useMemo(() => {
    if (!pursue) return null;
    if (pursue.id.startsWith('peer:')) {
      const uid = pursue.id.slice('peer:'.length);
      const p = (peers ?? []).find((x) => x.userId === uid);
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

  // Pursuit bundle (bearing + distance + compass + ETA) self → target.
  const pursuit = useMemo(
    () => (selfCoord && liveTarget ? buildPursuit(selfCoord, liveTarget.coord) : null),
    [selfCoord, liveTarget],
  );
  const pursueIsSos = !!liveTarget && liveTarget.id.startsWith('sos:');

  // Continuous GPS watch (expo-location) keeping `selfCoord` fresh as the user
  // moves so the arrow + ETA recompute live. Permission denial is non-destructive.
  const watchSubRef = useRef<Location.LocationSubscription | null>(null);
  // Set while the permission prompt or watch start is in flight, so a second tap
  // cannot start (and leak) a second watch.
  const startingRef = useRef(false);
  const noFixTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearNoFixTimer = useCallback(() => {
    if (noFixTimerRef.current) clearTimeout(noFixTimerRef.current);
    noFixTimerRef.current = null;
  }, []);
  // Weak signal, not refusal: keep the watch, and never override a fix that already arrived.
  const markUnavailable = useCallback(() => setGeoState((s) => (s === 'on' ? s : 'unavailable')), []);
  const enableLocation = useCallback(async () => {
    if (watchSubRef.current || startingRef.current) return; // already watching
    startingRef.current = true;
    setGeoState('locating');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGeoState('denied');
        return;
      }
      // Festival low-power mode (F-battery): trade GPS freshness for battery —
      // Balanced accuracy + a slower 10s tick instead of High/4s. The pursue
      // arrow just updates less often; nothing else about the feature changes.
      watchSubRef.current = await Location.watchPositionAsync(
        lowPowerMode
          ? { accuracy: Location.Accuracy.Balanced, distanceInterval: 3, timeInterval: 10000 }
          : { accuracy: Location.Accuracy.High, distanceInterval: 3, timeInterval: 4000 },
        (pos) => {
          const { latitude, longitude } = pos.coords;
          if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
            clearNoFixTimer();
            setSelfCoord({ latitude, longitude });
            setGeoState('on');
          }
        },
        (reason) => {
          console.warn('OfflineMap location watch', reason);
          markUnavailable();
        },
      );
      clearNoFixTimer();
      noFixTimerRef.current = setTimeout(() => {
        noFixTimerRef.current = null;
        markUnavailable();
      }, NO_FIX_TIMEOUT_MS);
    } catch (err) {
      console.warn('OfflineMap location start', err);
      markUnavailable();
    } finally {
      startingRef.current = false;
    }
  }, [lowPowerMode, clearNoFixTimer, markUnavailable]);
  const retryLocation = useCallback(() => {
    watchSubRef.current?.remove();
    watchSubRef.current = null;
    clearNoFixTimer();
    void enableLocation();
  }, [clearNoFixTimer, enableLocation]);
  // Every no-fix line's tap: retry after a refusal or weak signal, else start.
  const locate = useCallback(() => {
    if (geoState === 'unavailable' || geoState === 'denied') retryLocation();
    else void enableLocation();
  }, [geoState, retryLocation, enableLocation]);
  useEffect(() => {
    return () => {
      watchSubRef.current?.remove();
      watchSubRef.current = null;
      clearNoFixTimer();
    };
  }, [clearNoFixTimer]);
  // The tab stays mounted, so stop GPS when the screen loses focus. On return,
  // resume only while a pursue target still needs live position.
  const pursueActiveRef = useRef(false);
  useEffect(() => {
    pursueActiveRef.current = pursue !== null;
  }, [pursue]);
  useFocusEffect(
    useCallback(() => {
      if (pursueActiveRef.current) void enableLocation();
      return () => {
        watchSubRef.current?.remove();
        watchSubRef.current = null;
        clearNoFixTimer();
        setGeoState((g) => (g === 'denied' ? g : 'idle'));
      };
    }, [enableLocation, clearNoFixTimer]),
  );

  // Frame a point. `__festieFlyTo` only exists once the map is up; the `&&` guard
  // no-ops otherwise, and webRef is null while the fallback list shows. Only
  // numbers that passed Number.isFinite are spliced in.
  const flyTo = useCallback((longitude: number, latitude: number, zoom: number) => {
    if (!webRef.current || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    webRef.current.injectJavaScript(
      `window.__festieFlyTo && window.__festieFlyTo(${longitude}, ${latitude}, ${zoom}); true;`,
    );
  }, []);

  // "Nearest X": searches the FULL amenity set (ignores chip visibility). With no
  // fix it finds you first, and the effect below finishes the same tap.
  const runNearest = useCallback(
    (type: AmenityType) => {
      const step = nearestStep(type, amenityPins, selfCoord);
      if (step.kind === 'missing') {
        setPendingNearest(null);
        setNearestNotice({ kind: 'missing', type });
        return;
      }
      if (step.kind === 'need-fix') {
        setNearestNotice(null);
        setPendingNearest(type);
        locate();
        return;
      }
      setPendingNearest(null);
      setNearestNotice(null);
      setPlace(null);
      setPursue(nearestTarget(step));
      flyTo(step.pin.longitude, step.pin.latitude, 16);
    },
    [amenityPins, selfCoord, locate, flyTo],
  );
  useEffect(() => {
    if (!selfCoord || !pendingNearest) return;
    runNearest(pendingNearest);
  }, [selfCoord, pendingNearest, runNearest]);

  const allPins = useMemo(() => [...pins, ...stagePins, ...amenityPins], [pins, stagePins, amenityPins]);
  const selectPin = useCallback((pin: Pin) => {
    setPlace(placeFromPin(pin));
    setPursue(null);
    setNearestNotice(null);
    setPendingNearest(null);
    setPendingRecenter(false);
  }, []);
  // Close a card whose pin is no longer mapped (deleted, coords removed, crew or
  // festival changed). An amenity hidden by its chip keeps its card: allPins ignores the filter.
  useEffect(() => {
    if (place && !findMapPin(place.kind, place.id, allPins)) setPlace(null);
  }, [place, allPins]);
  // Leaving the interactive map (authoring, placing) or switching festival drops the card and any Nearest.
  const festivalId = festival?.id;
  useEffect(() => {
    setPlace(null);
    setPendingNearest(null);
    setPendingRecenter(false);
    setNearestNotice(null);
  }, [interactive, festivalId]);

  const clearPursue = useCallback(() => setPursue(null), []);
  const toggleAmenity = useCallback((type: AmenityType) => {
    setHiddenAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Phase 3A: choose the basemap style + the (optional) PMTiles host for this
  // festival. A festival with NO offline basemap yields the unchanged online OSM
  // raster style + a null host — exactly today's behaviour (graceful fallback).
  const remoteBasemapHost = useMemo(() => pmtilesHost(festival?.mapConfig), [festival]);

  // Phase 3B: the festival's configured (remote, https) PMTiles URL, if any. Used
  // both as the cache source and as the fallback when caching is unavailable.
  const remotePmtilesUrl = useMemo(
    () => (hasOfflineBasemap(festival?.mapConfig) ? festival!.mapConfig!.offlineBasemap!.pmtilesUrl : null),
    [festival],
  );
  const basemapAttribution = useMemo(
    () => (hasOfflineBasemap(festival?.mapConfig) ? festival?.mapConfig?.offlineBasemap?.attribution : undefined),
    [festival],
  );

  // Phase 3B native cache: once a festival with an offline basemap opens, download
  // the .pmtiles to app cache ONCE (idempotent) and point the WebView at the local
  // file:// so subsequent opens render with zero network. On failure we keep the
  // REMOTE https URL (Phase 3A range-fetch path) — additive, never regresses.
  //
  // We store the cached result TAGGED with the URL it was cached for; a switch to
  // a different festival is handled by comparing that tag against the current URL
  // during render (below) — no synchronous reset-in-effect needed.
  // The document gets the archive's BYTES, not its file:// URI: WebKit's fetch
  // rejects file://, so on iOS every tile failed and the map drew pins on a blank
  // ground. Keyed by the local URI, which the style's pmtiles:// source names.
  const [cachedBasemap, setCachedBasemap] = useState<{ url: string; uri: string; base64: string } | null>(null);
  // When the archive is already on disk, hold the WebView until its bytes are read.
  // Starting on the remote archive and swapping documents a moment later left the
  // first open half-drawn.
  const archiveOnDisk = useMemo(
    () => (remotePmtilesUrl ? basemapCacheInfo(remotePmtilesUrl).cached : false),
    [remotePmtilesUrl],
  );
  const [checkedArchiveUrl, setCheckedArchiveUrl] = useState<string | null>(null);
  const waitingForArchive = archiveOnDisk && checkedArchiveUrl !== remotePmtilesUrl;
  useEffect(() => {
    let cancelled = false;
    if (!remotePmtilesUrl) return;
    void ensureBasemapCached(remotePmtilesUrl).then(async (uri) => {
      const base64 = uri ? await readCachedBase64(remotePmtilesUrl) : null;
      if (cancelled) return;
      if (uri && base64) setCachedBasemap({ url: remotePmtilesUrl, uri, base64 });
      setCheckedArchiveUrl(remotePmtilesUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [remotePmtilesUrl]);

  // The EFFECTIVE basemap the WebView will read: the local cached file ONLY when
  // it was cached for the CURRENTLY configured URL (so a stale file from another
  // festival never leaks across); else the remote https URL (Phase 3A); else no
  // offline basemap. Derived during render — no effect/setState churn.
  const localArchive =
    cachedBasemap && remotePmtilesUrl && cachedBasemap.url === remotePmtilesUrl ? cachedBasemap : null;
  const localBasemapUri = localArchive?.uri ?? null;
  const usingLocalBasemap = localBasemapUri != null;

  // Can this map actually draw a BASEMAP right now? The MapLibre runtime is
  // vendored, so it always starts — which means a tile-less map would come up
  // blank instead of failing, and MapLibre reports per-source tile failures as
  // routine events we deliberately swallow (see the `sourceId` branch in
  // lib/mapDocument.ts). Offline with no cached archive is therefore the one
  // case the document itself cannot detect, and the exact case the honest
  // fallback copy describes: no network AND no local .pmtiles = provably no
  // basemap, so stay on the pin list rather than render pins on an empty
  // canvas. Not a failure latch — reconnecting flips this back and retries.
  const canRenderMap = usingLocalBasemap || !offlineMode;
  const mapStyle = useMemo(() => {
    if (usingLocalBasemap && localBasemapUri) {
      // Local file:// archive — build the vector style directly off the local URI
      // via the SAME shared style builder (single source of truth).
      return pmtilesVectorStyle(localBasemapUri, basemapAttribution, theme);
    }
    // Remote https basemap (Phase 3A), or the themed online OpenFreeMap style.
    return pickMapStyle(festival?.mapConfig, theme);
  }, [usingLocalBasemap, localBasemapUri, basemapAttribution, festival, theme]);

  // The remote host is permitted in the CSP/allowlist ONLY while we're still
  // reading the remote archive. Once the local copy is in use, no remote origin
  // is needed (and isn't added) — the map reads the embedded bytes.
  const offlineBasemapHost = usingLocalBasemap ? null : remoteBasemapHost;

  // Phase 4B: the host of the configured site-plan image, if any. Threaded into
  // the CSP img-src + the navigation allowlist so the raster can load while
  // keeping default-deny (EXACTLY this one https origin, no wildcard). Null when
  // the festival has no site plan — CSP/allowlist byte-for-byte as before.
  const siteplanImageHost = useMemo(() => {
    if (!siteplan) return null;
    try {
      return new URL(siteplan.imageUrl).hostname;
    } catch {
      return null;
    }
  }, [siteplan]);

  // The HTML doc carries NO pin data — only the numeric center, the chosen
  // basemap style, and the site-plan image host (for the CSP) — so it rebuilds
  // only when those change (pins/zones/siteplan data flow in via injectJavaScript).
  const html = useMemo(
    () =>
      buildMapHtml(
        center,
        mapStyle,
        offlineBasemapHost,
        false,
        siteplanImageHost,
        theme,
        localArchive ? { url: localArchive.uri, base64: localArchive.base64 } : null,
      ),
    [center, mapStyle, offlineBasemapHost, siteplanImageHost, theme, localArchive],
  );

  // Navigation guard + origin whitelist, widened by EXACTLY the festival's
  // PMTiles host (remote mode) and/or the site-plan image host — default-deny
  // preserved; only configured origins are ever added. The WebView never needs
  // file access: a saved archive arrives as bytes inside the document.
  const extraHosts = useMemo(
    () => [offlineBasemapHost, siteplanImageHost].filter((h): h is string => !!h),
    [offlineBasemapHost, siteplanImageHost],
  );
  const shouldStartLoad = useMemo(() => makeShouldStartLoad(extraHosts), [extraHosts]);
  const originWhitelist = useMemo(() => {
    const base = [...MAP_ORIGIN_WHITELIST];
    for (const h of extraHosts) base.push(`https://${h}`);
    return base;
  }, [extraHosts]);

  const source = useMemo(() => ({ html }), [html]);

  // 'loading' → WebView mounted, waiting for MapLibre; 'map' → interactive map up;
  // 'fallback' → CDN/offline failure, render the honest list instead. Start in
  // loading whenever there's anything to plot (meeting points, festival map data,
  // OR live markers).
  //
  // P0 authoring deadlock fix: a brand-new festival with no plottable features
  // would otherwise render the fallback list, never mount the WebView, and the
  // authoring inject (which bails on phase !== 'map') could never fire — so a NEW
  // festival could never be mapped. Force the map to mount whenever authoring is
  // armed (authoringMode !== 'off') OR the festival carries a camera (center !=
  // null), so the editor always has a tappable canvas. Crew behaviour is
  // unchanged for truly-unmapped festivals (center is null + authoring 'off').
  const hasAnythingToPlot =
    pins.length > 0 ||
    hasStages ||
    hasAmenities ||
    hasZones ||
    hasSiteplan ||
    hasLive ||
    authoringMode !== 'off' ||
    center != null;
  const [webviewPhase, setPhase] = useState<'loading' | 'map' | 'fallback'>(
    hasAnythingToPlot ? 'loading' : 'fallback',
  );
  // The phase everything below reads. `canRenderMap` is an OVERRIDE, not a state
  // transition: while it is false there is provably no basemap to draw, so the
  // honest list wins no matter what the WebView is doing. Deriving it (rather
  // than latching it into state) means reconnecting, or a cached archive landing,
  // restores the map on the next render with nothing to reset.
  const phase = canRenderMap ? webviewPhase : 'fallback';
  // Bumped on every 'ready'. A rebuilt document (theme or basemap change) reloads while
  // phase stays 'map', so the inject effects key on this to replay into the new page.
  const [docGen, setDocGen] = useState(0);

  // One-shot framing flags. A rebuilt document (theme/archive swap) starts with the
  // default camera, so 'ready' resets them to replay the bounds fit and SOS framing.
  const fitBoundsRef = useRef(false);
  const framedSosRef = useRef<Set<string>>(new Set());

  const fellBackRef = useRef(false);
  // Holds the in-flight offline-fallback timer so a new onLoadStart (the WebView
  // can fire it repeatedly) clears the prior one instead of stacking timers, and
  // so we can clear it on unmount. Behavior is unchanged — only the leak is fixed.
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallBack = useCallback(() => {
    if (fellBackRef.current) return;
    fellBackRef.current = true;
    setPhase('fallback');
  }, []);
  // Clears the latched failure and remounts the WebView (phase 'loading').
  const retryMap = useCallback(() => {
    fellBackRef.current = false;
    setPhase('loading');
  }, []);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: {
        type?: string;
        reason?: string;
        latitude?: number;
        longitude?: number;
        on?: boolean;
        id?: string;
        label?: string;
        kind?: string;
      } = {};
      try {
        msg = JSON.parse(e.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        if (!fellBackRef.current) {
          fitBoundsRef.current = false;
          framedSosRef.current = new Set();
          setPlacing(false);
          setPhase('map');
          setDocGen((g) => g + 1);
        }
      } else if (msg.type === 'pursue-select') {
        // A live peer / SOS marker tap. Toggle: re-tapping the same target clears.
        const { id, label, latitude, longitude } = msg;
        if (
          typeof id === 'string' &&
          typeof latitude === 'number' &&
          typeof longitude === 'number' &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude)
        ) {
          setPlace(null);
          setPendingNearest(null);
          setPendingRecenter(false);
          setPursue((prev) =>
            prev && prev.id === id
              ? null
              : { id, label: label || 'Target', coord: { latitude, longitude } },
          );
        }
      } else if (msg.type === 'place-select') {
        // A stage, amenity or meeting-point tap. The message is untrusted: it only
        // names a pin, and the card shows that pin's store data, never message text.
        const { id, kind } = msg;
        if (!interactive || typeof id !== 'string') return;
        if (kind !== 'meeting-point' && kind !== 'stage' && kind !== 'amenity') return;
        const pin = findMapPin(kind, id, allPins);
        if (pin) selectPin(pin);
      } else if (msg.type === 'placement') {
        // The WebView confirms the true placement state (it auto-exits after a
        // drop) — mirror it so the toggle button reflects reality.
        setPlacing(!!msg.on);
      } else if (msg.type === 'map-longpress') {
        // Tap-to-create: relay the tapped coord to the screen, which opens the
        // existing meeting-point form prefilled with it. The WebView has already
        // exited placement mode (one-shot); clear our local flag to match.
        // Range-check so a bad payload can't propagate non-finite coords.
        setPlacing(false);
        const { latitude, longitude } = msg;
        if (
          onMapPress &&
          typeof latitude === 'number' &&
          typeof longitude === 'number' &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude)
        ) {
          onMapPress({ latitude, longitude });
        }
      } else if (msg.type === 'error') {
        // Only a load/init failure means "no map" → fall back. A transient
        // pin/peer/recenter glitch must NOT tear the whole map down.
        if (
          msg.reason !== 'pin-update' &&
          msg.reason !== 'peer-update' &&
          msg.reason !== 'flyto' &&
          msg.reason !== 'mapdata-update' &&
          msg.reason !== 'zones-update' &&
          msg.reason !== 'siteplan-update' &&
          msg.reason !== 'draftpoints-update' &&
          msg.reason !== 'fitbounds'
        )
          fallBack();
      }
    },
    [fallBack, onMapPress, interactive, allPins, selectPin],
  );

  // Arm a load timeout on load start: if the document never signals 'ready'
  // within the window we assume the WebView never came up and fall back to the
  // list. (Pre-vendoring this doubled as the "no CDN" probe; it no longer does —
  // canRenderMap covers offline-with-no-archive.)
  const armTimeout = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setPhase((p) => {
        if (p === 'loading') {
          fellBackRef.current = true;
          return 'fallback';
        }
        return p;
      });
    }, LOAD_TIMEOUT_MS);
  }, []);

  // Clear any pending fallback timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // If we fell back only because there was nothing to plot or because no basemap
  // was reachable (NOT a load/init error — fellBackRef tracks real failures), try
  // the map once live markers, meeting points or festival map data show up. Also
  // re-arms the WebView after a canRenderMap override: coming back online with
  // webviewPhase stuck at 'map' would otherwise skip the reload the remount needs.
  useEffect(() => {
    if (phase === 'fallback' && !fellBackRef.current && hasAnythingToPlot) {
      setPhase('loading');
    }
  }, [phase, hasAnythingToPlot]);

  // Push meeting-point pins into the WebView once the map is up and whenever they
  // change. This is the ONLY path pin data enters the document — serialized with
  // the hardened context-aware serializer, never templated into the HTML (H3).
  const pinsJson = useMemo(() => safeJsonForScript(pins), [pins]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetPins && window.__festieSetPins(${pinsJson}); true;`);
  }, [phase, docGen, pinsJson]);

  // Push live peer + SOS markers into the WebView whenever they change and the
  // map is up. injectJavaScript re-renders the live layer (peers move). Same
  // hardened serializer — peer username / SOS message are user-controlled (L6).
  const liveJson = useMemo(() => safeJsonForScript({ items: livePins }), [livePins]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetPeers && window.__festieSetPeers(${liveJson}); true;`);
  }, [phase, docGen, liveJson]);

  // Push static festival map data (stage + amenity markers) into the WebView when
  // the map is up and whenever it changes. Same hardened serializer (labels are
  // user/admin-controlled). Independent of the meeting/peer/SOS layers.
  const mapDataJson = useMemo(() => safeJsonForScript(mapMarkers), [mapMarkers]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetMapData && window.__festieSetMapData(${mapDataJson}); true;`);
  }, [phase, docGen, mapDataJson]);

  // Push zone polygons (a GeoJSON FeatureCollection with color baked in + label
  // anchors) into the WebView when the map is up and whenever they change. Same
  // hardened serializer (zone labels are admin-controlled). Independent layer.
  const zonesJson = useMemo(
    () => safeJsonForScript({ collection: zonesGeoJSON(zones), labels: zoneLabels(zones) }),
    [zones],
  );
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetZones && window.__festieSetZones(${zonesJson}); true;`);
  }, [phase, docGen, zonesJson]);

  // Push the site-plan raster overlay (Phase 4B) into the WebView when the map is
  // up and whenever it changes. A null payload tears the layer down. The image
  // URL is config-derived (https, host already in the CSP); same hardened
  // serializer. Independent of every other layer.
  // Offline, the https image cannot load, so a saved copy goes in as a data: URL
  // (img-src already allows data:).
  const siteplanUrl = siteplan?.imageUrl ?? null;
  const [cachedSiteplan, setCachedSiteplan] = useState<{ url: string; dataUrl: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!siteplanUrl) return;
    void ensureBasemapCached(siteplanUrl).then(async (uri) => {
      const base64 = uri ? await readCachedBase64(siteplanUrl) : null;
      const mime = /\.png$/i.test(siteplanUrl) ? 'image/png' : /\.jpe?g$/i.test(siteplanUrl) ? 'image/jpeg' : 'image/webp';
      if (!cancelled && base64) setCachedSiteplan({ url: siteplanUrl, dataUrl: `data:${mime};base64,${base64}` });
    });
    return () => {
      cancelled = true;
    };
  }, [siteplanUrl]);
  const siteplanJson = useMemo(() => {
    const src = siteplanImageSource(siteplan);
    const local = src && cachedSiteplan?.url === src.url ? cachedSiteplan.dataUrl : null;
    return safeJsonForScript(src && local ? { ...src, url: local } : src);
  }, [siteplan, cachedSiteplan]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(`window.__festieSetSiteplan && window.__festieSetSiteplan(${siteplanJson}); true;`);
  }, [phase, docGen, siteplanJson]);

  // Push in-progress authoring vertices/corners into the WebView (a dot per tap)
  // when the map is up and whenever they change. Keyed on the serialized string so
  // a fresh empty-array prop each render doesn't re-inject (identical primitive).
  const draftPointsJson = useMemo(() => safeJsonForScript(draftPoints ?? []), [draftPoints]);
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(
      `window.__festieSetDraftPoints && window.__festieSetDraftPoints(${draftPointsJson}); true;`,
    );
  }, [phase, docGen, draftPointsJson]);

  // Frame the map to the festival's explicit map-config bounds once it's up. The
  // map was already centered on camera.center via buildHtml; bounds (when the
  // config carries them) tighten the view to the grounds. Coords are numeric +
  // range-checked by the schema before they reach here. Fires once per map mount;
  // re-runs only if the bounds themselves change.
  const boundsKey = camera.bounds ? camera.bounds.flat().join(',') : '';
  useEffect(() => {
    if (phase !== 'map') {
      fitBoundsRef.current = false;
      return;
    }
    if (fitBoundsRef.current || !webRef.current || !camera.bounds) return;
    const [[west, south], [east, north]] = camera.bounds;
    if (![west, south, east, north].every((n) => Number.isFinite(n))) return;
    fitBoundsRef.current = true;
    webRef.current.injectJavaScript(
      `window.__festieFitBounds && window.__festieFitBounds(${west}, ${south}, ${east}, ${north}); true;`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, docGen, boundsKey]);

  // Push the authoring mode into the WebView whenever it (or the map phase)
  // changes (Phase D / 4A / 4B). The mode is whitelisted by buildSetAuthoringScript
  // before injection — only a known AuthoringMode can ever reach the document.
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) return;
    webRef.current.injectJavaScript(buildSetAuthoringScript(authoringMode));
  }, [phase, docGen, authoringMode]);

  // Zone drawing + site-plan corner placement need placement ARMED across multiple
  // taps (one vertex/corner per tap), so entering a multi-tap mode arms placement
  // automatically and leaving it disarms. Scoped to multi-tap transitions only —
  // stage/amenity placement (driven by the "Add meeting point" toggle) is never touched,
  // preserving their one-shot behaviour.
  const isMultiTapMode = (m: AuthoringMode) => m === 'zone' || m === 'siteplan';
  const prevAuthRef = useRef<AuthoringMode>('off');
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) {
      prevAuthRef.current = authoringMode;
      return;
    }
    if (isMultiTapMode(authoringMode)) {
      webRef.current.injectJavaScript('window.__festieSetPlacement && window.__festieSetPlacement(true); true;');
    } else if (isMultiTapMode(prevAuthRef.current)) {
      webRef.current.injectJavaScript('window.__festieSetPlacement && window.__festieSetPlacement(false); true;');
    }
    prevAuthRef.current = authoringMode;
  }, [phase, docGen, authoringMode]);

  // P1 safety: one-shot fly/frame to each incoming SOS the moment it first
  // appears, regardless of meeting pins. The WebView's renderLive only auto-frames
  // the live layer when there are NO pins — so with pins present a safety-critical
  // SOS could sit off-screen. We track framed SOS by userId and fire __festieFlyTo
  // exactly once per SOS (not on every position tick); the framed set is reset when
  // the map remounts, and a cleared SOS drops its flag so a re-raise re-frames.
  // With several at once the last-framed wins the camera. Web force-flies likewise.
  useEffect(() => {
    if (phase !== 'map' || !webRef.current) {
      framedSosRef.current = new Set(); // re-frame after a remount
      return;
    }
    const present = new Set(sosList.map((s) => s.userId));
    // Drop framed flags for SOS that cleared so a later re-raise re-frames.
    for (const uid of Array.from(framedSosRef.current)) {
      if (!present.has(uid)) framedSosRef.current.delete(uid);
    }
    for (const s of sosList) {
      if (!s.position || framedSosRef.current.has(s.userId)) continue;
      const { lat, lng } = s.position;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      framedSosRef.current.add(s.userId);
      webRef.current.injectJavaScript(`window.__festieFlyTo && window.__festieFlyTo(${lng}, ${lat}, 16); true;`);
    }
  }, [phase, docGen, sosList]);

  // Map focus (the Map tab's focusStage): fly to the stage and open its card once
  // per id. Placed after the bounds fit and SOS framing so neither undoes it. An
  // id with no stage pin does nothing; a cleared id re-arms the next focus.
  const focusedPinRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPinId) {
      focusedPinRef.current = null;
      return;
    }
    if (phase !== 'map' || !webRef.current || focusedPinRef.current === focusPinId) return;
    const pin = stagePins.find((p) => p.id === focusPinId);
    if (!pin) return;
    focusedPinRef.current = focusPinId;
    flyTo(pin.longitude, pin.latitude, 17);
    selectPin(pin);
    onFocusHandled?.();
  }, [phase, docGen, focusPinId, stagePins, flyTo, selectPin, onFocusHandled]);

  // Toggle placement mode in the WebView. The next single map tap (while on)
  // drops a meeting point and auto-exits. We optimistically flip local state for
  // immediate button feedback; the WebView's 'placement' message reconciles it.
  const togglePlacement = useCallback(() => {
    if (phase !== 'map' || !webRef.current) return;
    const next = !placing;
    setPlacing(next);
    webRef.current.injectJavaScript(
      `window.__festieSetPlacement && window.__festieSetPlacement(${next ? 'true' : 'false'}); true;`,
    );
  }, [phase, placing]);

  // "Find me": fly to the fix the shared watch already holds. With none yet, start
  // the watch and finish the tap when the first fix lands; denied or unavailable
  // shows the same location notice (with Try again) as Nearest.
  const recenterToMe = useCallback(() => {
    if (selfCoord) {
      flyTo(selfCoord.longitude, selfCoord.latitude, 16);
      return;
    }
    setPendingRecenter(true);
    locate();
  }, [selfCoord, flyTo, locate]);
  useEffect(() => {
    if (!selfCoord || !pendingRecenter) return;
    setPendingRecenter(false);
    flyTo(selfCoord.longitude, selfCoord.latitude, 16);
  }, [selfCoord, pendingRecenter, flyTo]);

  // Show the user's own position in the document (blue dot). Replays after a reload.
  useEffect(() => {
    if (phase !== 'map' || !webRef.current || !selfCoord) return;
    const { longitude, latitude } = selfCoord;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
    webRef.current.injectJavaScript(
      `window.__festieSetSelf && window.__festieSetSelf(${longitude}, ${latitude}); true;`,
    );
  }, [phase, docGen, selfCoord]);

  const loadFailed = canRenderMap && phase === 'fallback' && hasAnythingToPlot;

  // ── Fallback list (offline-honest) ─────────────────────────────────────────
  if (phase === 'fallback') {
    const coorded = pins;
    const livePeerPins = livePins.filter((p) => p.kind === 'peer');
    const hasAny = coorded.length > 0 || uncoordedPoints.length > 0 || livePins.length > 0;
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.fallbackContent, { paddingBottom: bottomPad + bottomInset }]}>
        <View style={styles.banner}>
          <Ionicons name="cloud-offline-outline" size={iconSize.action} color={t.colors.accent.amber} />
          {/* Say only what is true for THIS festival: a download helps only when
              an archive exists to download, and the control that starts it lives on
              Schedule, Map and My Picks (there is nothing to fetch once you are offline). */}
          <Text style={styles.bannerText}>
            {loadFailed
              ? "The map didn't load. Showing your saved meeting points."
              : remotePmtilesUrl
                ? 'Download this festival from the Schedule or Map screen while you still have signal to use the map offline. Showing your saved meeting points.'
                : 'This festival has no offline map. Showing your saved meeting points.'}
          </Text>
          {loadFailed ? (
            <Button label="Retry map" size="sm" variant="secondary" onPress={retryMap} maxFontSizeMultiplier={MAX_FONT_SCALE} />
          ) : null}
        </View>

        {/* SOS first — safety-critical, even with no map. One row per active SOS. */}
        {sosList.map((s) => (
          <View
            key={`sos:${s.userId}`}
            style={styles.sosRow}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={`SOS from ${s.username}${s.message ? ', ' + s.message : ''}`}
          >
            <Ionicons name="warning" size={20} color={t.colors.accent.coral} />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{s.username} — SOS</Text>
              <Text style={styles.rowSub}>
                {s.message || (s.position ? 'Shared their location' : 'No location — reach them directly')}
              </Text>
              {s.position ? (
                <Text style={styles.rowCoord}>
                  {s.position.lat.toFixed(5)}, {s.position.lng.toFixed(5)}
                </Text>
              ) : null}
            </View>
          </View>
        ))}

        {/* Live peers — honest "last seen N ago" with no map. */}
        {livePeerPins.map((p) => (
          <View
            key={p.id}
            style={styles.row}
            accessible
            // Non-interactive info row (no onPress) — 'text', not 'button', so
            // screen readers don't announce a phantom actionable control.
            accessibilityRole="text"
            accessibilityLabel={`${p.label}, ${p.sublabel}`}
            accessibilityHint={`${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`}
          >
            <Ionicons name="navigate-circle" size={iconSize.action} color={t.colors.accent.aqua} />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{p.label}</Text>
              <Text style={styles.rowSub}>{p.sublabel}</Text>
              <Text style={styles.rowCoord}>
                {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
              </Text>
            </View>
          </View>
        ))}

        {!hasAny && onSetMeetingPoint ? (
          <View style={styles.emptyBlock}>
            {/* One-off 32px: sits between iconSize.lg (24) and .xl (48) — neither
                token fits this empty-state glyph without a visible size jump. */}
            <Ionicons name="location-outline" size={32} color={t.colors.text.muted} />
            <Text style={styles.emptyTitle}>No meeting points yet</Text>
            <Text style={styles.emptyMsg}>
              Add a meeting point with a location in the Crew tab and it'll show here.
            </Text>
          </View>
        ) : null}

        {coorded.map((pin) => (
          <View
            key={pin.id}
            style={styles.row}
            // a11y: announce the whole row as one meeting-point entry so the
            // coords read as metadata, not a separate flat list item.
            accessible={true}
            // Non-interactive info row (no onPress) — 'text', not 'button'.
            accessibilityRole="text"
            accessibilityLabel={`Meeting point: ${pin.label}${pin.sublabel ? ', ' + pin.sublabel : ''}`}
            accessibilityHint={`${pin.latitude.toFixed(5)}, ${pin.longitude.toFixed(5)}`}
          >
            {/* Aqua, not coral: a meeting-point pin is a neutral location cue;
                coral is danger/SOS-only per the one-accent rule. */}
            <Ionicons name="location" size={iconSize.action} color={t.colors.accent.aqua} />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{pin.label}</Text>
              {pin.sublabel ? <Text style={styles.rowSub}>{pin.sublabel}</Text> : null}
              <Text style={styles.rowCoord}>
                {pin.latitude.toFixed(5)}, {pin.longitude.toFixed(5)}
              </Text>
            </View>
          </View>
        ))}

        {uncoordedPoints.map((p) => (
          <View
            key={p.id}
            style={styles.row}
            accessible={true}
            // Non-interactive info row (no onPress) — 'text', not 'button'.
            accessibilityRole="text"
            accessibilityLabel={`Meeting point: ${p.label}${p.location ? ', ' + p.location : ''}`}
            accessibilityHint="No coordinates pinned"
          >
            <Ionicons name="location-outline" size={iconSize.action} color={t.colors.text.muted} />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{p.label}</Text>
              {p.location ? <Text style={styles.rowSub}>{p.location}</Text> : null}
              <Text style={styles.rowCoordMuted}>No pinned location</Text>
            </View>
          </View>
        ))}

        {/* Stage/amenity map data: honest note when this festival was never mapped. */}
        {!hasStages && !hasAmenities ? (
          <Text style={styles.stageNote}>This festival isn't mapped yet.</Text>
        ) : null}
      </ScrollView>
    );
  }

  // ── Map (WebView) ───────────────────────────────────────────────────────────
  const showDock = hasAmenities && authoringMode === 'off';
  const showCard = interactive && !!place;
  // Android's native tab bar already absorbs the bottom inset (see map.tsx), as SOS does.
  const fabInset = (Platform.OS === 'ios' ? insets.bottom : 0) + bottomInset;
  const call911 = () => {
    Linking.openURL('tel:911').catch((err: unknown) => console.warn('OfflineMap call 911', err));
  };
  return (
    <View style={styles.screen}>
      {waitingForArchive ? (
        <View style={styles.web} />
      ) : (
        <WebView<object>
          ref={webRef}
          // Default-deny navigation: the document is an inline (about:blank) page;
          // only its own load + OSM raster tiles are
          // expected. Anything else (e.g. an injected redirect) is blocked so a
          // payload can't navigate the WebView off to an attacker host. Pairs with
          // the in-document CSP for defense in depth behind the H3 transport fix.
          originWhitelist={originWhitelist}
          onShouldStartLoadWithRequest={shouldStartLoad}
          source={source}
          style={styles.web}
          onMessage={onMessage}
          onLoadStart={armTimeout}
          onError={fallBack}
          onHttpError={fallBack}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState={false}
        />
      )}
      {phase === 'loading' ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color={t.colors.accent.aqua} />
          <Text style={styles.loadingText}>Loading map…</Text>
        </View>
      ) : null}

      {/* On-map controls (map phase only). "Find me" recenters to the device's
          GPS fix; the "Add meeting point" toggle puts the map into placement mode so the
          next single tap drops a meeting point (reliable on touch, unlike a
          long-press). When armed, a hint in the top slot tells the user to tap the map. */}
      {phase === 'map' ? (
        <>
          {/* Crew controls (drop-pin FAB, find-me, chip bar) are gated OFF in
              authoring mode — the admin editor drives placement via its own armed
              toolbar, and these would collide with that flow. The drop-pin FAB
              also hides while a place card is open. */}
          {onMapPress && authoringMode === 'off' && !showCard ? (
            <TouchableOpacity
              testID="map-drop-pin-toggle"
              style={[
                styles.dropPinButton,
                { bottom: styles.dropPinButton.bottom + fabInset },
                placing ? styles.dropPinButtonActive : null,
              ]}
              onPress={togglePlacement}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={placing ? 'Cancel dropping a meeting point' : 'Add a meeting point on the map'}
              accessibilityState={{ selected: placing }}
            >
              <Ionicons
                name={placing ? 'close' : 'add-circle-outline'}
                size={16}
                color={placing ? t.colors.text.onAccent : t.colors.accent.aqua}
              />
              <Text
                style={[styles.dropPinText, placing ? styles.dropPinTextActive : null]}
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {placing ? 'Cancel' : 'Add meeting point'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {authoringMode === 'off' ? (
            <TouchableOpacity
              testID="map-recenter-fab"
              style={[styles.recenterFab, { bottom: styles.recenterFab.bottom + fabInset }]}
              onPress={recenterToMe}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Recenter the map on my location"
            >
              {pendingRecenter && geoState === 'locating' ? (
                <ActivityIndicator size="small" color={t.colors.accent.aqua} />
              ) : (
                <Ionicons name="locate" size={20} color={t.colors.accent.aqua} />
              )}
            </TouchableOpacity>
          ) : null}

          {/* Nearest-X + amenity filter chips, one scrollable bar at the top of the map. */}
          {showDock ? (
            <View style={styles.chipDock} pointerEvents="box-none">
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
                keyboardShouldPersistTaps="handled"
              >
                {/* All three show whenever any amenity is mapped, so a miss can say so. */}
                {NEAREST_AMENITY_TYPES.map((type) => {
                  const { glyph } = amenityGlyph(type);
                  const name = humanizeAmenityType(type).toLowerCase();
                  return (
                    <TouchableOpacity
                      key={`near-${type}`}
                      style={styles.nearestChip}
                      onPress={() => runNearest(type)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`Show the way to the nearest ${name}`}
                    >
                      <Text style={styles.chipGlyph} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {glyph}
                      </Text>
                      <Text style={styles.nearestChipText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {`${MAP_COPY.nearest} ${name}`}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {MAP_AMENITY_CATEGORIES.filter((type) => amenityPins.some((p) => p.amenityType === type)).map((type) => {
                  const { glyph } = amenityGlyph(type);
                  const on = !hiddenAmenities.has(type);
                  const name = humanizeAmenityType(type);
                  return (
                    <TouchableOpacity
                      key={`filter-${type}`}
                      style={[styles.filterChip, on ? styles.filterChipOn : styles.filterChipOff]}
                      onPress={() => toggleAmenity(type)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${on ? 'Hide' : 'Show'} ${name}`}
                    >
                      <Text
                        style={[styles.chipGlyph, on ? null : styles.chipGlyphOff]}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        {glyph}
                      </Text>
                      <Text
                        style={[styles.filterChipText, on ? styles.filterChipTextOn : null]}
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                      >
                        {name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {/* One top slot under the chip bar. Priority: pursue bar, place card,
              Nearest notice, placement hint. */}
          <View
            style={[styles.topSlot, { top: showDock ? t.spacing[3] + 44 + t.spacing[2] : t.spacing[3] }]}
            pointerEvents="box-none"
          >
            {liveTarget ? (
              // Pursue overlay: directional arrow + "Alex · 210 m NE · ~3 min".
              <View
                style={[styles.pursueBar, pursueIsSos ? styles.pursueBarSos : null]}
                accessibilityRole="text"
                accessibilityLabel={
                  pursuit ? showingWayLabel(liveTarget.label, pursuit) : locationPromptCopy(geoState, liveTarget.label)
                }
              >
                {selfCoord && pursuit && Number.isFinite(pursuit.bearingDeg) ? (
                  <Ionicons
                    name="navigate"
                    size={24}
                    color={pursueIsSos ? t.colors.accent.coral : t.colors.accent.aqua}
                    // The Ionicons "navigate" glyph points NE (45°) at rotation 0,
                    // so subtract 45° from the compass bearing — a due-north target
                    // (bearing 0) then points straight up.
                    style={{ transform: [{ rotate: `${pursuit.bearingDeg - 45}deg` }] }}
                  />
                ) : (
                  <Ionicons name="navigate-outline" size={24} color={t.colors.text.muted} />
                )}
                <View style={styles.pursueBody}>
                  {selfCoord && pursuit ? (
                    <>
                      <Text style={styles.pursueName} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {liveTarget.label}
                      </Text>
                      <Text style={styles.pursueLabel} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {`${pursuit.distanceLabel}${pursuit.compass ? ' ' + pursuit.compass : ''}${pursuit.etaLabel !== '—' ? ' · ~' + pursuit.etaLabel : ''}`}
                      </Text>
                    </>
                  ) : (
                    <TouchableOpacity onPress={locate} accessibilityRole="button">
                      <Text style={styles.pursueEnable} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {locationPromptCopy(geoState, liveTarget.label)}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {liveTarget.id.startsWith('peer:') ? (
                  <TouchableOpacity
                    onPress={() => router.push(peerCompassHref(liveTarget.id.slice('peer:'.length)))}
                    accessibilityRole="button"
                    accessibilityLabel={FIND_FRIEND_COPY.openCompassA11y(liveTarget.label)}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                  >
                    <Text style={styles.pursueEnable} maxFontSizeMultiplier={1.4}>
                      {FIND_FRIEND_COPY.openCompass}
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={clearPursue}
                  style={styles.pursueClose}
                  hitSlop={{ top: 10, bottom: 10, left: 4, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={MAP_COPY.stopShowingWay}
                >
                  <Ionicons name="close" size={16} color={t.colors.text.muted} />
                </TouchableOpacity>
              </View>
            ) : showCard && place ? (
              <MapPlaceCard
                place={place}
                selfCoord={selfCoord}
                geoState={geoState}
                onShowWay={() => {
                  setPursue(placeTarget(place));
                  setPlace(null);
                }}
                onSetMeetingPoint={onSetMeetingPoint}
                onLocate={locate}
                onClose={() => setPlace(null)}
              />
            ) : interactive && (nearestNotice || pendingNearest || pendingRecenter) ? (
              <View style={styles.notice}>
                <View style={styles.noticeRow}>
                  <Text
                    style={[styles.noticeText, styles.noticeBody]}
                    accessibilityRole={nearestNotice ? 'alert' : 'text'}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                  >
                    {nearestNotice
                      ? nearestMissingCopy(nearestNotice.type)
                      : geoState === 'denied' || geoState === 'unavailable'
                        ? locationPromptCopy(geoState)
                        : locationPromptCopy('locating')}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setNearestNotice(null);
                      setPendingNearest(null);
                      setPendingRecenter(false);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Dismiss"
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="close" size={16} color={t.colors.text.muted} />
                  </TouchableOpacity>
                </View>
                {nearestNotice?.type === 'medical' ? (
                  <Button
                    label={MAP_COPY.call911}
                    size="sm"
                    variant="secondary"
                    icon="call-outline"
                    onPress={call911}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                  />
                ) : null}
                {!nearestNotice && (geoState === 'denied' || geoState === 'unavailable') ? (
                  <Button
                    label={MAP_COPY.tryAgain}
                    size="sm"
                    variant="secondary"
                    onPress={retryLocation}
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                  />
                ) : null}
              </View>
            ) : onMapPress && authoringMode === 'off' && placing ? (
              <View style={styles.mapHint} pointerEvents="none">
                <Ionicons name="locate-outline" size={iconSize.compact} color={t.colors.text.onAccent} />
                <Text style={styles.mapHintText} numberOfLines={1} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  Tap the map where you want to meet
                </Text>
              </View>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  web: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    backgroundColor: t.colors.bg.primary,
  },
  loadingText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // Round "find me" control, pinned bottom-right above the SOS FAB's row so the
  // two don't collide (SOS sits lower-right via the map screen's own wrapper).
  // SOS adds the home-indicator inset, so these must too (applied inline).
  recenterFab: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5] + 64,
    width: 48,
    height: 48,
    borderRadius: t.radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  // ── Top slot under the chip bar: pursue bar, place card, Nearest notice or hint ──
  topSlot: {
    position: 'absolute',
    left: t.spacing[4],
    right: t.spacing[4],
  },
  notice: {
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.elevated,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  noticeText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.primary,
  },
  // ── Pursue overlay (arrow + label), first in the top slot ──────────────────
  pursueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.elevated,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  pursueBarSos: {
    borderColor: t.colors.accent.coral,
  },
  pursueBody: {
    flex: 1,
    minWidth: 0,
  },
  pursueLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  pursueName: {
    ...typeStyle('caption', 700),
    color: t.colors.text.primary,
  },
  pursueEnable: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  pursueClose: {
    padding: t.spacing[1],
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  noticeBody: {
    flex: 1,
    minWidth: 0,
  },
  // ── Nearest-X + amenity filter chip bar, top of the map ─────────────────────
  chipDock: {
    position: 'absolute',
    top: t.spacing[3],
    left: 0,
    right: 0,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
  },
  chipGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  chipGlyphOff: {
    opacity: 0.4,
  },
  // The basemap under the chips varies, so they need an opaque themed ground.
  nearestChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.elevated,
  },
  nearestChipText: {
    ...typeStyle('micro', 600),
    color: t.colors.text.primary,
  },
  filterChip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
  },
  filterChipOn: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.elevated,
  },
  filterChipOff: {
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  filterChipText: {
    ...typeStyle('micro'),
    color: t.colors.text.muted,
  },
  filterChipTextOn: {
    color: t.colors.text.primary,
  },
  // Tap-to-create hint, centred in the top slot, non-interactive.
  mapHint: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.shade[10],
  },
  mapHintText: {
    ...typeStyle('micro'),
    color: t.colors.text.onAccent,
  },
  // "Add meeting point" placement toggle, pinned bottom-right just above the "find me"
  // FAB. Pill shows the idle (aqua icon + label) vs armed (coral fill) state.
  dropPinButton: {
    position: 'absolute',
    right: t.spacing[4],
    bottom: t.spacing[5] + 64 + 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  dropPinButtonActive: {
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.accent.coralStrong,
  },
  dropPinText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  dropPinTextActive: {
    color: t.colors.text.onAccent,
  },
  fallbackContent: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.amber,
    backgroundColor: t.colors.amberAlpha[12],
  },
  bannerText: {
    ...typeStyle('caption'),
    // Neutral tone: amber icon + border already signal "offline"; muted text
    // keeps this informational ("here's what you get offline") rather than
    // reading as an error/warning.
    color: t.colors.text.muted,
    flexShrink: 1,
  },
  emptyBlock: {
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[6],
  },
  emptyTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  emptyMsg: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  sosRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowLabel: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  rowSub: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  rowCoord: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  rowCoordMuted: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  stageNote: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    textAlign: 'center',
    paddingTop: t.spacing[2],
  },
}));
