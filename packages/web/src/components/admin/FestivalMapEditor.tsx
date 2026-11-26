import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { colors } from '@festie/shared/tokens';
import { uploadSiteplanImage } from '@festie/shared/services';
import {
  amenityCount,
  buildAmenityFeature,
  appendAmenity,
  removeAmenity,
  moveAmenity,
  moveZone,
  setAmenityLabel as renameAmenity,
  setZoneLabel as renameZone,
  parseLatLng,
  stageCoordFromTap,
  humanizeAmenityType,
  buildZoneFeature,
  appendZone,
  removeZone,
  zoneCount,
  extractZones,
  ZONE_PALETTE,
  buildSiteplan,
  setSiteplan,
  removeSiteplan,
  extractSiteplan,
  isHttpsUrl,
  clampOpacity,
  SITEPLAN_DEFAULT_OPACITY,
  isPmtilesInput,
  PMTILES_PATH_RE,
  setOfflineBasemap,
  SITEPLAN_CORNER_LABELS,
  SITEPLAN_CORNER_COUNT,
} from '@festie/shared/utils';
import type { AmenityType, Festival, FestivalMapConfig, Stage } from '@festie/shared/types';
import { useToast } from '../../lib/toastContext';
import { useUnsavedChangesGuard } from '../../hooks/useUnsavedChangesGuard';
import { cn } from '../../lib/utils';
import Button from '../ui/Button';
import MapAmenitiesPanel from './MapAmenitiesPanel';
import MapBasemapPanel from './MapBasemapPanel';
import MapSiteplanPanel from './MapSiteplanPanel';
import MapZonesPanel from './MapZonesPanel';
import type { ArmedTarget, Vertex } from './festivalMapEditorTypes';

// CrewMap is heavy (MapLibre); lazy-load it exactly like the crew surface does so
// it never lands in the admin bundle until the map editor opens.
const CrewMap = lazy(() => import('../crew/CrewMap'));

/**
 * Admin — web festival MAP editor (Phase D parity with the mobile
 * app/admin/festival-map.tsx screen).
 *
 * Places/moves stage pins and drops amenity markers on the real web CrewMap
 * (MapLibre directly — no WebView bridge, that's mobile-only), then persists via
 * the SAME PUT /admin/festivals/:id write path: per-stage latitude/longitude on
 * the stage rows + festival.mapConfig. All authoring math is the shared pure
 * `@festie/shared` mapAuthoring helpers, so web + mobile stay in parity.
 *
 * Loads the FULL festival (stages/timeZone) and round-trips the non-geo fields
 * on save. The save never sends `days`, so it never touches lineup data.
 */

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
}

interface StageEdit {
  id: string;
  name: string;
  color: string;
  latitude: number | null;
  longitude: number | null;
}

const DEFAULT_STAGE_COLOR = colors.stage.fallback;
const MAX_SITEPLAN_BYTES = 10 * 1024 * 1024;

export interface FestivalMapEditorProps {
  festivalId: string;
  /** Back to the festival list/edit view. */
  onClose: () => void;
  /** Leave the map for the festival editor (shown when the festival has no stages). */
  onEditFestival?: () => void;
  /** `manage` is an organizer: the festival loads and saves through /manage, and the site-plan overlay is left out (C17). */
  scope?: 'admin' | 'manage';
}

export default function FestivalMapEditor({ festivalId, onClose, onEditFestival, scope = 'admin' }: FestivalMapEditorProps) {
  const { toast, toastError } = useToast();

  const [name, setName] = useState('');
  const [stages, setStages] = useState<StageEdit[]>([]);
  const [mapConfig, setMapConfig] = useState<FestivalMapConfig | null>(null);
  const [detail, setDetail] = useState<FestivalDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  // Set by every edit handler, never by the load, so leaving can warn about unsaved changes.
  // Venue: the festival latitude/longitude the map camera and weather use.
  const [venue, setVenue] = useState<Vertex | null>(null);
  const [venueDirty, setVenueDirty] = useState(false);
  const [venueText, setVenueText] = useState('');
  const [venueError, setVenueError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [armed, setArmed] = useState<ArmedTarget>(null);
  const [amenityLabel, setAmenityLabel] = useState('');
  // Zone drawing (Phase 4A): the in-progress polygon vertices + the chosen
  // color/label. Committed on "Finish"; the preview shows the draft live.
  const [draftVertices, setDraftVertices] = useState<Vertex[]>([]);
  const [zoneColor, setZoneColor] = useState<string>(ZONE_PALETTE[0].color);
  const [zoneLabel, setZoneLabel] = useState('');
  const isDrawingZone = armed?.kind === 'zone';
  // Site-plan overlay (Phase 4B): the https image URL + opacity are edited fields;
  // the 4 corners are tapped on the map (TL, TR, BR, BL) while armed. The
  // committed corners live in mapConfig.siteplan.
  const [siteplanUrl, setSiteplanUrl] = useState('');
  const [siteplanOpacity, setSiteplanOpacity] = useState<number>(SITEPLAN_DEFAULT_OPACITY);
  const [draftCorners, setDraftCorners] = useState<Vertex[]>([]);
  // Offline basemap: the typed file and credit. A value that is not valid is shown but never put in mapConfig.
  const [basemapUrl, setBasemapUrl] = useState('');
  const [basemapCredit, setBasemapCredit] = useState('');
  const isPlacingSiteplan = armed?.kind === 'siteplan';
  // Snapshot of what was loaded or last saved; the editor is dirty when it differs.
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const dirty =
    snapshot !== null &&
    (JSON.stringify({ stages, mapConfig }) !== snapshot || venueDirty || draftVertices.length > 0 || draftCorners.length > 0);
  const { confirmLeave, guardDialog } = useUnsavedChangesGuard(dirty);

  const load = useCallback(async () => {
    setLoadError(false);
    setLoading(true);
    try {
      const full = await api.get<FestivalDetail>(`/${scope}/festivals/${festivalId}`);
      setDetail(full);
      setName(full.name || '');
      const loadedStages: StageEdit[] = (full.stages || []).map((s) => ({
        id: s.id || `stage-${Date.now()}`,
        name: s.name || '',
        color: s.color || DEFAULT_STAGE_COLOR,
        latitude: typeof s.latitude === 'number' ? s.latitude : null,
        longitude: typeof s.longitude === 'number' ? s.longitude : null,
      }));
      setStages(loadedStages);
      setMapConfig(full.mapConfig ?? null);
      setSnapshot(JSON.stringify({ stages: loadedStages, mapConfig: full.mapConfig ?? null }));
      setVenue(
        typeof full.latitude === 'number' && typeof full.longitude === 'number'
          ? { latitude: full.latitude, longitude: full.longitude }
          : null,
      );
      setVenueDirty(false);
      // Hydrate the site-plan URL + opacity fields from the existing config (the
      // corners stay committed in mapConfig until the admin re-taps them).
      const existingSp = extractSiteplan(full.mapConfig ?? null);
      setSiteplanUrl(existingSp?.imageUrl ?? '');
      setSiteplanOpacity(existingSp?.opacity ?? SITEPLAN_DEFAULT_OPACITY);
      setBasemapUrl(full.mapConfig?.offlineBasemap?.pmtilesUrl ?? '');
      setBasemapCredit(full.mapConfig?.offlineBasemap?.attribution ?? '');
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [festivalId, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const editStages = useCallback((updater: (prev: StageEdit[]) => StageEdit[]) => {
    setStages(updater);
  }, []);
  const editMapConfig = useCallback((updater: (prev: FestivalMapConfig | null) => FestivalMapConfig | null) => {
    setMapConfig(updater);
  }, []);
  const applyVenue = useCallback((next: Vertex) => {
    setVenueDirty(true);
    setVenue(next);
  }, []);

  // The config the PREVIEW renders: the committed config, plus the in-progress
  // zone (once it has ≥3 vertices) appended as a draft so the organizer sees the
  // polygon take shape as they tap. The draft is never saved — only committed
  // zones live in `mapConfig`.
  const previewConfig = useMemo(() => {
    let cfg = mapConfig;
    if (isDrawingZone && draftVertices.length >= 3) {
      const draft = buildZoneFeature(draftVertices, { color: zoneColor, label: zoneLabel || 'Drawing…' }, 'zone-draft');
      if (draft) cfg = appendZone(cfg, draft);
    }
    // While placing corners, preview the site plan as soon as all 4 are tapped and
    // the URL is a valid https image (the draft is never saved on its own).
    if (isPlacingSiteplan && draftCorners.length === SITEPLAN_CORNER_COUNT && isHttpsUrl(siteplanUrl)) {
      const sp = buildSiteplan(siteplanUrl, draftCorners, siteplanOpacity);
      if (sp) cfg = setSiteplan(cfg, sp);
    }
    // A typed /tiles/ path becomes an absolute URL only when the server saves it, so resolve it here to
    // let the preview use the file before Save.
    const typed = cfg?.offlineBasemap?.pmtilesUrl;
    if (cfg && typeof typed === 'string' && PMTILES_PATH_RE.test(typed)) {
      cfg = setOfflineBasemap(cfg, `${window.location.origin}${typed}`, cfg.offlineBasemap?.attribution);
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

  // Fold stages into a Festival-shaped object for the live CrewMap preview. The
  // cast is safe: CrewMap reads only stages[], mapConfig and the geocoded venue
  // (the camera fallback, so an unmapped festival opens on its grounds).
  const mapFestival = useMemo(
    () =>
      ({
        id: festivalId,
        name,
        latitude: venue?.latitude ?? null,
        longitude: venue?.longitude ?? null,
        mapConfig: previewConfig,
        stages: stages as unknown as Stage[],
      }) as Festival & { stages?: Stage[] },
    [festivalId, name, venue, previewConfig, stages],
  );

  // A click on the map applies to the armed target (one-shot: disarms after).
  const handleMapClick = useCallback(
    (coord: { latitude: number; longitude: number }) => {
      if (!armed) return;
      // Zone drawing: each click appends a vertex and STAYS armed (multi-tap),
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
        if (typeof next.latitude === 'number' && typeof next.longitude === 'number') {
          applyVenue({ latitude: next.latitude, longitude: next.longitude });
        }
      } else if (armed.kind === 'move-amenity') {
        editMapConfig((prev) => moveAmenity(prev, armed.id, coord));
      } else if (armed.kind === 'move-zone') {
        editMapConfig((prev) => moveZone(prev, armed.id, coord));
      } else if (armed.kind === 'stage') {
        const next = stageCoordFromTap(coord);
        editStages((prev) =>
          prev.map((s) => (s.id === armed.stageId ? { ...s, latitude: next.latitude, longitude: next.longitude } : s)),
        );
      } else {
        const feature = buildAmenityFeature(coord, armed.amenityType, amenityLabel);
        if (feature) editMapConfig((prev) => appendAmenity(prev, feature));
        setAmenityLabel('');
      }
      setArmed(null);
    },
    [armed, amenityLabel, applyVenue, editMapConfig, editStages],
  );

  const armStage = (stageId: string) =>
    setArmed((prev) => (prev?.kind === 'stage' && prev.stageId === stageId ? null : { kind: 'stage', stageId }));
  const armAmenity = (amenityType: AmenityType) =>
    setArmed((prev) =>
      prev?.kind === 'amenity' && prev.amenityType === amenityType ? null : { kind: 'amenity', amenityType },
    );

  const armVenue = () => setArmed((prev) => (prev?.kind === 'venue' ? null : { kind: 'venue' }));
  const armMoveAmenity = (id: string) =>
    setArmed((prev) => (prev?.kind === 'move-amenity' && prev.id === id ? null : { kind: 'move-amenity', id }));
  const armMoveZone = (id: string) =>
    setArmed((prev) => (prev?.kind === 'move-zone' && prev.id === id ? null : { kind: 'move-zone', id }));
  const applyVenueText = () => {
    const parsed = parseLatLng(venueText);
    if (!parsed) {
      setVenueError('Use latitude, longitude. For example: 28.53834, -81.37923');
      return;
    }
    setVenueError(null);
    setVenueText('');
    applyVenue(parsed);
  };

  const clearStagePin = (stageId: string) =>
    editStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, latitude: null, longitude: null } : s)));
  const removeAmenityById = (amenityId: string) => editMapConfig((prev) => removeAmenity(prev, amenityId));
  const renameAmenityById = (amenityId: string, label: string) =>
    editMapConfig((prev) => renameAmenity(prev, amenityId, label));
  const renameZoneById = (zoneId: string, label: string) => editMapConfig((prev) => renameZone(prev, zoneId, label));

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
    if (feature) editMapConfig((prev) => appendZone(prev, feature));
    setDraftVertices([]);
    setZoneLabel('');
    setArmed(null);
  };
  const removeZoneById = (zoneId: string) => editMapConfig((prev) => removeZone(prev, zoneId));

  const onBasemapChange = (url: string, credit: string) => {
    setBasemapUrl(url);
    setBasemapCredit(credit);
    const value = url.trim();
    if (value === '') editMapConfig((prev) => (prev ? setOfflineBasemap(prev, null) : prev));
    else if (isPmtilesInput(value)) editMapConfig((prev) => setOfflineBasemap(prev, value, credit));
  };

  // ── Site-plan overlay controls (Phase 4B) ──────────────────────────────────
  // The committed site plan (corners + url + opacity), if any.
  const committedSiteplan = useMemo(() => extractSiteplan(mapConfig), [mapConfig]);
  // Convert stored [lng,lat] corners back to {latitude,longitude} for re-commits.
  const cornersToLatLng = (corners: [number, number][]) =>
    corners.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
  // Re-commit a site plan through the shared validator; no-op if it doesn't build.
  const recommitSiteplan = (url: string, corners: Vertex[], opacity: number) => {
    const sp = buildSiteplan(url, corners, opacity);
    if (sp) editMapConfig((prev) => setSiteplan(prev, sp));
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
  const onSiteplanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_SITEPLAN_BYTES) {
      setUploadError('The image must be 10 MB or smaller.');
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const { imageUrl } = await uploadSiteplanImage(festivalId, file, file.name);
      onSiteplanUrlChange(imageUrl);
      toast('Image uploaded. Now mark the four corners.', 'success');
    } catch (err: unknown) {
      toastError(err, "Couldn't upload the image. Try again.");
    } finally {
      setUploading(false);
    }
  };
  const removeSiteplanOverlay = () => {
    editMapConfig((prev) => removeSiteplan(prev));
    setDraftCorners([]);
    setArmed((prev) => (prev?.kind === 'siteplan' ? null : prev));
  };

  // Per-tap draft dots for the live preview (web-parity with native OfflineMap):
  // the in-progress zone vertices while drawing, or the site-plan corners while
  // placing. Empty otherwise — no dots drawn.
  const draftPoints = isDrawingZone ? draftVertices : isPlacingSiteplan ? draftCorners : [];

  const amenityFeatures = mapConfig?.amenities?.features ?? [];
  // Committed zones (the draft preview is rendered separately via previewConfig).
  const placedZones = useMemo(() => extractZones(mapConfig), [mapConfig]);

  // A typed value that is not valid is never put in mapConfig, so saving would silently keep the old one.
  const basemapInvalid = scope === 'admin' && basemapUrl.trim() !== '' && !isPmtilesInput(basemapUrl.trim());

  const handleSave = async () => {
    if (!detail || basemapInvalid) return;
    if (draftVertices.length > 0) {
      toast('Finish or cancel the zone you are drawing, then save the map.', 'error');
      return;
    }
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
      mapConfig,
    };
    if (venueDirty && venue) {
      payload.latitude = venue.latitude;
      payload.longitude = venue.longitude;
    }

    setSaving(true);
    try {
      await api.put<void>(`/${scope}/festivals/${festivalId}`, payload);
      toast('Festival map saved', 'success');
      setSnapshot(JSON.stringify({ stages, mapConfig }));
      setVenueDirty(false);
      setDraftVertices([]);
      setDraftCorners([]);
      onClose();
    } catch (err: unknown) {
      toastError(err, "Couldn't save the map. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading festival map…</div>;
  }
  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-text-secondary">Couldn’t load this festival.</p>
        <button
          onClick={() => void load()}
          className="px-4 py-2 rounded-xl bg-accent-aqua text-[var(--text-on-light-accent)] hover:opacity-80 transition-opacity text-sm font-medium"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="type-label text-text-primary">Festival map — {name || 'Untitled'}</h2>
        <button
          onClick={() => confirmLeave(onClose)}
          className="px-3 py-1.5 rounded-md bg-bg-primary border border-glass-border text-text-secondary hover:text-text-primary transition-colors text-sm"
        >
          Back
        </button>
      </div>

      {/* Live map preview. Clicking the map applies to the armed target. */}
      <div className="relative">
        <Suspense fallback={<div className="h-72 flex-center text-text-muted">Loading map…</div>}>
          <CrewMap
            meetingPoints={[]}
            festival={mapFestival}
            onMapClick={armed ? handleMapClick : undefined}
            draftPoints={draftPoints}
            authoring
          />
        </Suspense>
        {armed && (
          <div
            className="absolute top-2 left-1/2 -translate-x-1/2 z-[1] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent-aqua text-[var(--text-on-light-accent)] text-xs font-medium shadow-lg pointer-events-none"
            role="status"
          >
            {armed.kind === 'venue'
              ? 'Click the map at the venue'
              : armed.kind === 'move-amenity'
                ? `Click the map where ${amenityFeatures.find((f) => f.properties.id === armed.id)?.properties.label || 'this amenity'} should go`
                : armed.kind === 'move-zone'
                  ? `Click the map where the center of ${placedZones.find((z) => z.id === armed.id)?.label || 'this zone'} should go`
                  : armed.kind === 'stage'
                    ? 'Click the map to set this stage’s location'
                    : armed.kind === 'amenity'
                      ? `Click the map to drop a ${humanizeAmenityType(armed.amenityType)} marker`
                      : armed.kind === 'siteplan'
                        ? draftCorners.length >= SITEPLAN_CORNER_COUNT
                          ? 'All 4 corners set — apply them below'
                          : `Click the ${SITEPLAN_CORNER_LABELS[draftCorners.length]} corner (${draftCorners.length}/${SITEPLAN_CORNER_COUNT})`
                        : draftVertices.length >= 3
                          ? `Finish the zone, or click the map to add more points (${draftVertices.length} added)`
                          : `Click the map to add zone points (${draftVertices.length} added — need 3+)`}
          </div>
        )}
      </div>

      {/* Venue: the festival point the map camera and weather use */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-xl p-4 space-y-3">
        <h3 className="type-label text-text-primary">Venue</h3>
        <p className="text-xs text-text-muted">
          {venue
            ? `The map and weather use ${venue.latitude.toFixed(5)}, ${venue.longitude.toFixed(5)}.`
            : 'No venue point yet. Festie looks up the location when you save the festival. If it can’t find it, set the venue here.'}
        </p>
        <Button variant="secondary" size="sm" aria-pressed={armed?.kind === 'venue'} onClick={armVenue}>
          {armed?.kind === 'venue' ? 'Cancel' : 'Set on map'}
        </Button>
        <div className="flex gap-2">
          <input
            type="text"
            aria-label="Venue coordinates"
            placeholder="Paste coordinates, e.g. 28.53834, -81.37923"
            value={venueText}
            onChange={(e) => setVenueText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyVenueText();
            }}
            className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <Button size="sm" onClick={applyVenueText}>
            Use
          </Button>
        </div>
        {venueError && (
          <p className="text-xs text-[var(--color-text-danger)]" role="alert">
            {venueError}
          </p>
        )}
      </div>

      {/* Stage locations */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-xl p-4">
        <h3 className="type-label text-text-primary mb-3">{scope === 'manage' ? 'Drop a pin where each stage is' : 'Stage locations'}</h3>
        {stages.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-text-muted">This festival has no stages yet.</p>
            {onEditFestival && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => confirmLeave(onEditFestival)}
              >
                Add stages
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {stages.map((stage) => {
              const pinned = typeof stage.latitude === 'number' && typeof stage.longitude === 'number';
              const isArmed = armed?.kind === 'stage' && armed.stageId === stage.id;
              return (
                <div key={stage.id} className="flex items-center gap-3">
                  <span
                    className="w-4 h-4 rounded-full border border-glass-border shrink-0"
                    style={{ backgroundColor: stage.color }}
                    aria-hidden="true"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-primary truncate">{stage.name || 'Untitled stage'}</p>
                    <p className="text-xs text-text-muted truncate">
                      {pinned ? `${stage.latitude!.toFixed(5)}, ${stage.longitude!.toFixed(5)}` : 'No location pinned'}
                    </p>
                  </div>
                  {pinned && (
                    <button
                      onClick={() => clearStagePin(stage.id)}
                      className="px-2 py-1.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors text-xs"
                      aria-label={`Clear ${stage.name || 'stage'} location`}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={() => armStage(stage.id)}
                    aria-pressed={isArmed}
                    className={cn(
                      'px-3 py-1.5 min-h-11 rounded-md text-xs font-medium transition-colors border',
                      isArmed
                        ? 'bg-accent-aqua text-[var(--text-on-light-accent)] border-accent-aqua'
                        : 'bg-accent-aqua/20 text-accent-aqua border-transparent hover:bg-accent-aqua/30',
                    )}
                  >
                    {isArmed ? 'Cancel' : pinned ? 'Move' : 'Set location'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Zones (camping / VIP / no-go / parking) */}
      <MapZonesPanel
        zoneTotal={zoneCount(mapConfig)}
        placedZones={placedZones}
        zoneLabel={zoneLabel}
        zoneColor={zoneColor}
        drawing={isDrawingZone}
        draftVertices={draftVertices}
        armed={armed}
        onZoneLabelChange={setZoneLabel}
        onZoneColorChange={setZoneColor}
        onStartZone={startZone}
        onUndoVertex={undoVertex}
        onFinishZone={finishZone}
        onCancelZone={cancelZone}
        onRename={renameZoneById}
        onArmMove={armMoveZone}
        onRemove={removeZoneById}
      />

      {/* Site plan overlay. Organizations cannot upload site plans yet (master plan C17). */}
      {scope === 'admin' && <MapSiteplanPanel
        url={siteplanUrl}
        opacity={siteplanOpacity}
        committed={!!committedSiteplan}
        placing={isPlacingSiteplan}
        draftCorners={draftCorners}
        uploading={uploading}
        uploadError={uploadError}
        onFile={(e) => void onSiteplanFile(e)}
        onUrlChange={onSiteplanUrlChange}
        onOpacityChange={onSiteplanOpacityChange}
        onStartCorners={startSiteplanCorners}
        onUndoCorner={undoCorner}
        onApplyCorners={applySiteplanCorners}
        onCancelCorners={cancelSiteplanCorners}
        onRemoveOverlay={removeSiteplanOverlay}
      />}

      {/* Offline map. Organizations cannot set it: the server only accepts files Festie hosts for admins. */}
      {scope === 'admin' && <MapBasemapPanel url={basemapUrl} attribution={basemapCredit} onChange={onBasemapChange} />}

      {/* Amenities */}
      <MapAmenitiesPanel
        amenityTotal={amenityCount(mapConfig)}
        amenityFeatures={amenityFeatures}
        label={amenityLabel}
        armed={armed}
        onLabelChange={setAmenityLabel}
        onArm={armAmenity}
        onRename={renameAmenityById}
        onArmMove={armMoveAmenity}
        onRemove={removeAmenityById}
      />

      <div className="flex gap-2 justify-end">
        <button
          onClick={() => confirmLeave(onClose)}
          disabled={saving}
          className="px-4 py-2 rounded-xl bg-bg-primary border border-glass-border text-text-primary hover:bg-bg-primary/80 transition-colors text-sm font-medium disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          disabled={saving || basemapInvalid}
          className="px-4 py-2 rounded-xl bg-accent-aqua text-[var(--text-on-light-accent)] hover:opacity-80 transition-opacity text-sm font-medium disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save map'}
        </button>
      </div>
      {guardDialog}
    </div>
  );
}
