import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { api, uploadSiteplanImage } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import {
  buildAmenityFeature,
  appendAmenity,
  removeAmenity,
  moveAmenity,
  setAmenityLabel as renameAmenity,
  moveZone,
  setZoneLabel as renameZone,
  parseLatLng,
  stageCoordFromTap,
  buildZoneFeature,
  appendZone,
  removeZone,
  extractZones,
  ZONE_PALETTE,
  buildSiteplan,
  setSiteplan,
  removeSiteplan,
  extractSiteplan,
  isHttpsUrl,
  clampOpacity,
  SITEPLAN_DEFAULT_OPACITY,
  SITEPLAN_CORNER_COUNT,
} from '@festie/shared/utils';
import type { AmenityType, Festival, FestivalMapConfig, Stage } from '@festie/shared/types';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { ConfirmDialog } from '../../components/admin';
import type { AuthoringMode } from '../../lib/webviewBridge';
import { useTokens } from '../../hooks/useTokens';
import MapAuthoringPane from '../../components/admin/festival-map/MapAuthoringPane';
import VenueSection from '../../components/admin/festival-map/VenueSection';
import StageLocationsSection from '../../components/admin/festival-map/StageLocationsSection';
import ZonesSection from '../../components/admin/festival-map/ZonesSection';
import SitePlanSection from '../../components/admin/festival-map/SitePlanSection';
import AmenitiesSection from '../../components/admin/festival-map/AmenitiesSection';
import type { ArmedTarget, StageEdit, Vertex } from '../../components/admin/festival-map/types';
import { useStyles } from '../../components/admin/festival-map/styles';

/**
 * Admin — Festival MAP editor (Phase D). The geo-authoring counterpart to
 * festival-edit.tsx: it owns placing/moving stage pins and dropping amenity
 * markers on the actual map, then persists via the SAME PUT /admin/festivals/:id
 * write path (per-stage latitude/longitude on stageRows + festival.mapConfig).
 *
 * Lives under app/admin/ so the root AuthGate (seg[0]==='admin') guards it; a
 * non-admin who reaches it sees the "Admins only" empty state (mirrors
 * festival-edit's guard).
 *
 * The map is the OfflineMap WebView in authoring mode. Authoring REUSES the
 * existing tap-to-place path: arming a target puts the map in placement mode, the
 * next single tap reports its coordinate via onMapPress, and we apply it to the
 * armed target (a stage pin, or a new amenity of the selected palette type). No
 * new tap channel, CSP, host-allowlist, or serializer change — see webviewBridge.
 *
 *   ?id=<festivalId>  (required — there's nothing to map without a festival)
 *   ?stageId=<stageId> (optional — arms that stage for placement once loaded)
 *
 * Save: PUT /admin/festivals/:id with name, location, timeZone, the edited stage
 * coords and mapConfig. The map save never sends lineup data: it leaves out `days`,
 * so the server keeps every day and set untouched. expectedUpdatedAt guards
 * against saving over a newer version.
 */

// Detail response from GET /admin/festivals/:id — loosely typed; we read what we need
// to (a) author geo and (b) round-trip the text fields on save.
interface FestivalDetail {
  id: string;
  name?: string;
  location?: string;
  timeZone?: string | null;
  updatedAt?: string;
  latitude?: number | null;
  longitude?: number | null;
  mapConfig?: FestivalMapConfig | null;
  stages?: { id?: string; name?: string; color?: string; latitude?: number | null; longitude?: number | null }[];
  days?: {
    id?: string;
    label?: string;
    date?: string;
    sets?: {
      id?: string;
      artist?: string;
      stageId?: string | null;
      startTime?: string | null;
      endTime?: string | null;
      linkUrl?: string | null;
      artists?: { name?: string; links?: Record<string, string> }[];
    }[];
  }[];
}

const MAX_SITEPLAN_BYTES = 10 * 1024 * 1024;


const DEFAULT_STAGE_COLOR = '#6a6a88';

export default function FestivalMapEditorScreen() {
  const t = useTokens();
  const styles = useStyles();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const { id, stageId: routeStageId } = useLocalSearchParams<{ id?: string; stageId?: string }>();
  const editingId = typeof id === 'string' && id.length > 0 ? id : null;

  const [name, setName] = useState('');
  const [stages, setStages] = useState<StageEdit[]>([]);
  const [mapConfig, setMapConfig] = useState<FestivalMapConfig | null>(null);
  // Non-geo fields we must round-trip verbatim on save (the server merges by id).
  const [detail, setDetail] = useState<FestivalDetail | null>(null);

  const [loading, setLoading] = useState(!!editingId);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Dirty flag: flipped by the geo edit handlers only (never by the initial
  // load hydration), so Cancel can tell an untouched map from one with
  // unsaved pin/zone/amenity/siteplan edits. Simplest honest signal — no deep compare.
  const [touched, setTouched] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  // Venue point (festival latitude/longitude) the map and weather use. Only sent on
  // save when the admin changed it, so a save never overwrites a server geocode.
  const [venue, setVenueState] = useState<{ latitude: number; longitude: number } | null>(null);
  const [venueDirty, setVenueDirty] = useState(false);
  const [venueText, setVenueText] = useState('');
  const [venueError, setVenueError] = useState<string | null>(null);
  const armedFromRoute = useRef(false);
  const setVenue = useCallback((next: { latitude: number; longitude: number }) => {
    setTouched(true);
    setVenueDirty(true);
    setVenueState(next);
  }, []);
  const updateStages = useCallback((updater: (prev: StageEdit[]) => StageEdit[]) => {
    setTouched(true);
    setStages(updater);
  }, []);
  const updateMapConfig = useCallback((updater: (prev: FestivalMapConfig | null) => FestivalMapConfig | null) => {
    setTouched(true);
    setMapConfig(updater);
  }, []);
  const [armed, setArmed] = useState<ArmedTarget>(null);
  // New-amenity label buffer (used when an amenity target is armed).
  const [amenityLabel, setAmenityLabel] = useState('');
  // Zone drawing (Phase 4A): in-progress polygon vertices + chosen color/label.
  const [draftVertices, setDraftVertices] = useState<Vertex[]>([]);
  const [zoneColor, setZoneColor] = useState<string>(ZONE_PALETTE[0].color);
  const [zoneLabel, setZoneLabel] = useState('');
  const isDrawingZone = armed?.kind === 'zone';
  // Site-plan overlay (Phase 4B): https image URL + opacity are typed fields; the
  // 4 corners are tapped on the map (TL, TR, BR, BL) while armed. Committed
  // corners live in mapConfig.siteplan.
  const [siteplanUrl, setSiteplanUrl] = useState('');
  const [siteplanOpacity, setSiteplanOpacity] = useState<number>(SITEPLAN_DEFAULT_OPACITY);
  const [draftCorners, setDraftCorners] = useState<Vertex[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<{ text: string; error: boolean } | null>(null);
  const isPlacingSiteplan = armed?.kind === 'siteplan';

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!editingId) return;
    setLoadError(false);
    try {
      const full = await api.get<FestivalDetail>(`/admin/festivals/${editingId}`);
      setDetail(full);
      setName(full.name || '');
      setStages(
        (full.stages || []).map((s) => ({
          id: s.id || `stage-${Date.now()}`,
          name: s.name || '',
          color: s.color || DEFAULT_STAGE_COLOR,
          latitude: typeof s.latitude === 'number' ? s.latitude : null,
          longitude: typeof s.longitude === 'number' ? s.longitude : null,
        })),
      );
      setMapConfig(full.mapConfig ?? null);
      setVenueState(
        typeof full.latitude === 'number' && typeof full.longitude === 'number'
          ? { latitude: full.latitude, longitude: full.longitude }
          : null,
      );
      setVenueDirty(false);
      if (routeStageId && !armedFromRoute.current && (full.stages || []).some((s) => s.id === routeStageId)) {
        armedFromRoute.current = true;
        setArmed({ kind: 'stage', stageId: routeStageId });
      }
      // Hydrate the site-plan URL + opacity fields from the existing config (the
      // corners stay committed in mapConfig until the admin re-taps them).
      const existingSp = extractSiteplan(full.mapConfig ?? null);
      setSiteplanUrl(existingSp?.imageUrl ?? '');
      setSiteplanOpacity(existingSp?.opacity ?? SITEPLAN_DEFAULT_OPACITY);
    } catch {
      setLoadError(true);
    }
  }, [editingId, routeStageId]);

  useEffect(() => {
    if (!isAdmin || !editingId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- load-once guard: nothing to fetch for non-admins / missing id; clear the initial loading flag. Tied to the fetch lifecycle, not derivable from render inputs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isAdmin, editingId, load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/admin');
  }, [router]);

  // Fold the live stages into a Festival-shaped object so OfflineMap can plot the
  // stage + amenity pins as they're authored (live preview). The cast is safe:
  // OfflineMap only reads stages[], mapConfig and the geocoded venue off this object.
  // The config the PREVIEW renders: committed config, plus the in-progress zone
  // (once it has ≥3 vertices) appended as a draft so the organizer watches the
  // polygon take shape. The draft is never saved — only committed zones persist.
  const previewConfig = useMemo(() => {
    let cfg = mapConfig;
    if (isDrawingZone && draftVertices.length >= 3) {
      const draft = buildZoneFeature(draftVertices, { color: zoneColor, label: zoneLabel || 'Drawing…' }, 'zone-draft');
      if (draft) cfg = appendZone(cfg, draft);
    }
    // While placing corners, preview the site plan once all 4 are tapped and the
    // URL is a valid https image (the draft is never saved on its own).
    if (isPlacingSiteplan && draftCorners.length === SITEPLAN_CORNER_COUNT && isHttpsUrl(siteplanUrl)) {
      const sp = buildSiteplan(siteplanUrl, draftCorners, siteplanOpacity);
      if (sp) cfg = setSiteplan(cfg, sp);
    }
    return cfg;
  }, [
    isDrawingZone,
    draftVertices,
    zoneColor,
    zoneLabel,
    mapConfig,
    isPlacingSiteplan,
    draftCorners,
    siteplanUrl,
    siteplanOpacity,
  ]);

  const mapFestival = useMemo(() => {
    return {
      id: editingId ?? 'draft',
      name,
      latitude: venue?.latitude ?? null,
      longitude: venue?.longitude ?? null,
      mapConfig: previewConfig,
      stages: stages as unknown as Stage[],
    } as Festival & { stages?: Stage[] };
  }, [editingId, name, venue, previewConfig, stages]);

  // The WebView authoring mode follows the armed target ('stage' / 'amenity' /
  // 'off'). Cosmetic on the WebView side; the tap still flows through onMapPress.
  const authoringMode: AuthoringMode =
    armed?.kind === 'venue' || armed?.kind === 'move-amenity' || armed?.kind === 'move-zone'
      ? 'stage'
      : (armed?.kind ?? 'off');

  // In-progress zone vertices / site-plan corners → per-tap dots on the map. Below
  // the polygon (3+) / overlay (4 corners) render threshold the preview shows
  // nothing, so these give the admin immediate "your tap landed here" feedback.
  const draftPoints = useMemo(
    () => (isDrawingZone ? draftVertices : isPlacingSiteplan ? draftCorners : []),
    [isDrawingZone, isPlacingSiteplan, draftVertices, draftCorners],
  );

  // ── Placement: a map tap landed ─────────────────────────────────────────────
  const handleMapPress = useCallback(
    (coord: { latitude: number; longitude: number }) => {
      if (!armed) return;
      // Zone drawing: each tap appends a vertex and STAYS armed (multi-tap),
      // unlike the one-shot stage/amenity placement below.
      if (armed.kind === 'zone') {
        setDraftVertices((prev) => [...prev, { latitude: coord.latitude, longitude: coord.longitude }]);
        return;
      }
      // Site-plan: collect up to 4 corners (TL, TR, BR, BL). Stays armed (multi-
      // tap); extra taps beyond 4 are ignored until the admin re-starts.
      if (armed.kind === 'siteplan') {
        setDraftCorners((prev) =>
          prev.length >= SITEPLAN_CORNER_COUNT
            ? prev
            : [...prev, { latitude: coord.latitude, longitude: coord.longitude }],
        );
        return;
      }
      if (armed.kind === 'venue') {
        const next = stageCoordFromTap(coord);
        if (next.latitude !== null && next.longitude !== null)
          setVenue({ latitude: next.latitude, longitude: next.longitude });
      } else if (armed.kind === 'move-amenity') {
        updateMapConfig((prev) => moveAmenity(prev, armed.id, coord));
      } else if (armed.kind === 'move-zone') {
        updateMapConfig((prev) => moveZone(prev, armed.id, coord));
      } else if (armed.kind === 'stage') {
        const next = stageCoordFromTap(coord);
        updateStages((prev) =>
          prev.map((s) => (s.id === armed.stageId ? { ...s, latitude: next.latitude, longitude: next.longitude } : s)),
        );
      } else {
        const feature = buildAmenityFeature(coord, armed.amenityType, amenityLabel);
        if (feature) updateMapConfig((prev) => appendAmenity(prev, feature));
        setAmenityLabel('');
      }
      // One-shot: disarm after a placement (matches the WebView's one-shot tap).
      setArmed(null);
    },
    [armed, amenityLabel, updateStages, updateMapConfig, setVenue],
  );

  const armStage = (stageId: string) =>
    setArmed((prev) => (prev?.kind === 'stage' && prev.stageId === stageId ? null : { kind: 'stage', stageId }));
  const armAmenity = (amenityType: AmenityType) =>
    setArmed((prev) =>
      prev?.kind === 'amenity' && prev.amenityType === amenityType ? null : { kind: 'amenity', amenityType },
    );

  const armVenue = () => setArmed((prev) => (prev?.kind === 'venue' ? null : { kind: 'venue' }));
  const armMoveAmenity = (amenityId: string) =>
    setArmed((prev) =>
      prev?.kind === 'move-amenity' && prev.id === amenityId ? null : { kind: 'move-amenity', id: amenityId },
    );
  const armMoveZone = (zoneId: string) =>
    setArmed((prev) => (prev?.kind === 'move-zone' && prev.id === zoneId ? null : { kind: 'move-zone', id: zoneId }));
  const applyVenueText = () => {
    const parsed = parseLatLng(venueText);
    if (!parsed) {
      setVenueError('Use latitude, longitude. For example: 28.53834, -81.37923');
      return;
    }
    setVenueError(null);
    setVenue(parsed);
    setVenueText('');
  };

  const clearStagePin = (stageId: string) =>
    updateStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, latitude: null, longitude: null } : s)));
  const renameAmenityById = (amenityId: string, label: string) =>
    updateMapConfig((prev) => renameAmenity(prev, amenityId, label));
  const renameZoneById = (zoneId: string, label: string) => updateMapConfig((prev) => renameZone(prev, zoneId, label));
  const removeAmenityById = (amenityId: string) => updateMapConfig((prev) => removeAmenity(prev, amenityId));

  // ── Zone drawing controls ───────────────────────────────────────────────────
  const startZone = () => {
    setDraftVertices([]);
    setArmed({ kind: 'zone' });
  };
  const undoVertex = () => setDraftVertices((prev) => prev.slice(0, -1));
  const cancelZone = () => {
    setDraftVertices([]);
    setArmed(null);
  };
  const finishZone = () => {
    const feature = buildZoneFeature(draftVertices, { color: zoneColor, label: zoneLabel });
    if (feature) updateMapConfig((prev) => appendZone(prev, feature));
    setDraftVertices([]);
    setZoneLabel('');
    setArmed(null);
  };
  const removeZoneById = (zoneId: string) => updateMapConfig((prev) => removeZone(prev, zoneId));

  // ── Site-plan overlay controls (Phase 4B) ──────────────────────────────────
  // The committed site plan (corners + url + opacity), if any. The URL is an
  // admin-provided https link — Festie hosts no arbitrary uploads, so this REUSES
  // the same link-out pattern as crew photo albums (crewPhotoAlbumSchema), which
  // siteplanSchema was explicitly built to mirror. The 4 corners are tapped on
  // the map (same one-shot placement path as stage/amenity/zone authoring).
  const committedSiteplan = useMemo(() => extractSiteplan(mapConfig), [mapConfig]);
  // Convert stored [lng,lat] corners back to {latitude,longitude} for re-commits.
  const cornersToLatLng = (corners: [number, number][]) =>
    corners.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  // Re-commit a site plan through the shared validator; no-op if it doesn't build.
  const recommitSiteplan = (url: string, corners: Vertex[], opacity: number) => {
    const sp = buildSiteplan(url, corners, opacity);
    if (sp) updateMapConfig((prev) => setSiteplan(prev, sp));
    return !!sp;
  };
  const startSiteplanCorners = () => {
    setDraftCorners([]);
    setArmed({ kind: 'siteplan' });
  };
  const undoCorner = () => setDraftCorners((prev) => prev.slice(0, -1));
  const cancelSiteplanCorners = () => {
    setDraftCorners([]);
    setArmed(null);
  };
  const applySiteplanCorners = () => {
    if (recommitSiteplan(siteplanUrl, draftCorners, siteplanOpacity)) {
      setDraftCorners([]);
      setArmed(null);
    }
  };
  const onSiteplanUrlChange = (v: string) => {
    setSiteplanUrl(v);
    // Live-update a committed overlay's image when the URL stays valid.
    if (committedSiteplan && isHttpsUrl(v)) {
      recommitSiteplan(v, cornersToLatLng(committedSiteplan.corners), siteplanOpacity);
    }
  };
  const onSiteplanOpacityChange = (v: number) => {
    const op = clampOpacity(v);
    setSiteplanOpacity(op);
    if (committedSiteplan) recommitSiteplan(committedSiteplan.imageUrl, cornersToLatLng(committedSiteplan.corners), op);
  };
  const pickAndUploadSiteplan = async () => {
    if (!editingId) return;
    setUploadNote(null);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setUploadNote({ text: 'Allow photo access to upload a site plan.', error: true });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      const asset = result.canceled ? null : result.assets?.[0];
      if (!asset) return;
      if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_SITEPLAN_BYTES) {
        setUploadNote({ text: 'The image must be 10 MB or smaller.', error: true });
        return;
      }
      setUploading(true);
      const blob = await (await fetch(asset.uri)).blob();
      const { imageUrl } = await uploadSiteplanImage(editingId, blob, asset.fileName ?? 'siteplan.jpg');
      onSiteplanUrlChange(imageUrl);
      setUploadNote({ text: 'Image uploaded. Now mark the four corners.', error: false });
    } catch (err: unknown) {
      setUploadNote({
        text: err instanceof Error ? err.message : "Couldn't upload the image. Try again.",
        error: true,
      });
    } finally {
      setUploading(false);
    }
  };
  const removeSiteplanOverlay = () => {
    updateMapConfig((prev) => removeSiteplan(prev));
    setDraftCorners([]);
    setArmed((prev) => (prev?.kind === 'siteplan' ? null : prev));
  };

  const amenityFeatures = mapConfig?.amenities?.features ?? [];
  // Committed zones (the draft preview renders separately via previewConfig).
  const placedZones = useMemo(() => extractZones(mapConfig), [mapConfig]);

  // ── Save ────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!editingId || !detail) return;
    setFormError(null);
    const payload: Record<string, unknown> = {
      name: detail.name?.trim() || name.trim(),
      location: detail.location?.trim() || '',
      timeZone: detail.timeZone ? detail.timeZone : null,
      stages: stages.map((s) => ({
        id: s.id,
        name: s.name.trim(),
        color: s.color,
        latitude: s.latitude,
        longitude: s.longitude,
      })),
      expectedUpdatedAt: detail.updatedAt,
      // object = replace, null = clear (Phase A write path).
      mapConfig: mapConfig,
      ...(venueDirty && venue ? { latitude: venue.latitude, longitude: venue.longitude } : {}),
    };

    setSaving(true);
    try {
      await api.put<void>(`/admin/festivals/${editingId}`, payload);
      goBack();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Couldn't save the map. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const goToFestivalEditor = () => {
    if (!editingId) return;
    router.dismissTo({ pathname: '/admin/festival-edit', params: { id: editingId } });
  };

  const headerTitle = 'Edit festival map';

  // Non-admins never reach the editor (AuthGate also blocks the route).
  if (!isAdmin) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="lock-closed-outline"
          title="Admins only"
          message="This area is restricted to festival administrators."
        />
      </View>
    );
  }

  if (!editingId) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="map-outline"
          title="No festival selected"
          message="Open a festival in the editor, then choose Edit map."
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <LoadingState label="Loading festival map" />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ title: headerTitle, headerShown: true }} />
        <EmptyState
          icon="cloud-offline-outline"
          title="Couldn't load festival"
          message="Something went wrong reaching the server."
          action={{ label: 'Try again', onPress: () => void load() }}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ title: headerTitle, headerShown: true }} />

      {/* The map — half the screen; the toolbar scrolls beneath it. Authoring
          mode follows the armed target; a tap applies to that target. */}
      <MapAuthoringPane
        amenityFeatures={amenityFeatures}
        armed={armed}
        authoringMode={authoringMode}
        draftCorners={draftCorners}
        draftPoints={draftPoints}
        draftVertices={draftVertices}
        handleMapPress={handleMapPress}
        mapFestival={mapFestival}
        placedZones={placedZones}
        stages={stages}
      />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(t.spacing[8], insets.bottom + t.spacing[6]) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Venue */}
          <VenueSection
            applyVenueText={applyVenueText}
            armVenue={armVenue}
            armed={armed}
            setVenueError={setVenueError}
            setVenueText={setVenueText}
            venue={venue}
            venueError={venueError}
            venueText={venueText}
          />

          {/* Stage locations */}
          <StageLocationsSection
            armStage={armStage}
            armed={armed}
            clearStagePin={clearStagePin}
            goToFestivalEditor={goToFestivalEditor}
            setShowLeaveConfirm={setShowLeaveConfirm}
            stages={stages}
            touched={touched}
          />

          {/* Zones (camping / VIP / no-go / parking) */}
          <ZonesSection
            armMoveZone={armMoveZone}
            armed={armed}
            cancelZone={cancelZone}
            draftVertices={draftVertices}
            finishZone={finishZone}
            isDrawingZone={isDrawingZone}
            mapConfig={mapConfig}
            placedZones={placedZones}
            removeZoneById={removeZoneById}
            renameZoneById={renameZoneById}
            setZoneColor={setZoneColor}
            setZoneLabel={setZoneLabel}
            startZone={startZone}
            undoVertex={undoVertex}
            zoneColor={zoneColor}
            zoneLabel={zoneLabel}
          />

          {/* Site plan overlay */}
          <SitePlanSection
            applySiteplanCorners={applySiteplanCorners}
            cancelSiteplanCorners={cancelSiteplanCorners}
            committedSiteplan={committedSiteplan}
            draftCorners={draftCorners}
            isPlacingSiteplan={isPlacingSiteplan}
            onSiteplanOpacityChange={onSiteplanOpacityChange}
            onSiteplanUrlChange={onSiteplanUrlChange}
            pickAndUploadSiteplan={pickAndUploadSiteplan}
            removeSiteplanOverlay={removeSiteplanOverlay}
            siteplanOpacity={siteplanOpacity}
            siteplanUrl={siteplanUrl}
            startSiteplanCorners={startSiteplanCorners}
            undoCorner={undoCorner}
            uploadNote={uploadNote}
            uploading={uploading}
          />

          {/* Amenities */}
          <AmenitiesSection
            amenityFeatures={amenityFeatures}
            amenityLabel={amenityLabel}
            armAmenity={armAmenity}
            armMoveAmenity={armMoveAmenity}
            armed={armed}
            mapConfig={mapConfig}
            removeAmenityById={removeAmenityById}
            renameAmenityById={renameAmenityById}
            setAmenityLabel={setAmenityLabel}
          />

          {formError ? (
            <Text style={styles.formError} accessibilityLiveRegion="polite">
              {formError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={() => (touched ? setShowCancelConfirm(true) : goBack())}
              style={[styles.actionBtn, styles.cancelBtn]}
              activeOpacity={0.7}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => void handleSave()}
              style={[styles.actionBtn, styles.saveBtn, saving && styles.btnDisabled]}
              activeOpacity={0.7}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save map"
            >
              <Text style={styles.saveBtnText} maxFontSizeMultiplier={1.4}>
                {saving ? 'Saving…' : 'Save map'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmDialog
        visible={showLeaveConfirm}
        title="Leave the map editor?"
        message="Your map changes are not saved yet."
        confirmLabel="Leave without saving"
        destructive
        onConfirm={() => {
          setShowLeaveConfirm(false);
          goToFestivalEditor();
        }}
        onCancel={() => setShowLeaveConfirm(false)}
      />
      <ConfirmDialog
        visible={showCancelConfirm}
        title="Discard changes?"
        message="You have unsaved map edits. Leaving now discards them."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setShowCancelConfirm(false);
          goBack();
        }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </View>
  );
}
