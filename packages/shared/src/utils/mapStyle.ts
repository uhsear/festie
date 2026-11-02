// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * mapStyle.ts — pure MapLibre style selection for the festival map (Phase 3A),
 * shared by web (CrewMap, OfflineMap.web) and the native WebView document.
 *
 * A festival with NO `offlineBasemap.pmtilesUrl` renders the online OpenFreeMap
 * vector basemap (themed). Only when a festival carries a valid https PMTiles URL
 * do we switch to a minimal Protomaps-style VECTOR basemap reading
 * `pmtiles://<url>`.
 *
 * This module owns ONLY the style JSON (a plain object MapLibre accepts) + the
 * pmtiles-host extraction used by the security allowlists. It has no map/DOM
 * deps and registers no protocol — the renderer (which holds the maplibre +
 * pmtiles instances) does `addProtocol('pmtiles', new pmtiles.Protocol().tile)`.
 */

import type { FestivalMapConfig } from '../types/domain';
import type { ThemePreference } from '../stores/uiStore';

/** A MapLibre style object (`version` is the literal 8 MapLibre requires). */
export interface MapStyleObject {
  version: 8;
  sources: Record<string, unknown>;
  layers: Array<Record<string, unknown>>;
}

/**
 * The single host behind every OpenFreeMap style: style JSON, TileJSON, vector
 * tiles, glyphs and sprites. The web CSP (lib/helpers.ts) and the native
 * WebView CSP + host allowlist must permit exactly this host.
 */
export const OPENFREEMAP_HOST = 'tiles.openfreemap.org';

/**
 * The online default basemap: OpenFreeMap vector styles (OpenStreetMap data, no
 * API key, no request limit). Dark for Stage, light for Daylight, so the map
 * matches the app theme and stays readable in sunlight. Attribution comes from
 * the style's TileJSON, so MapLibre's attribution control credits OpenFreeMap,
 * OpenMapTiles and OpenStreetMap without extra code.
 */
export function openFreeMapStyleUrl(theme: ThemePreference = 'stage'): string {
  return `https://${OPENFREEMAP_HOST}/styles/${theme === 'daylight' ? 'positron' : 'dark'}`;
}

const PMTILES_PALETTE = {
  stage: { background: '#0c0c14', earth: '#15151f', landuse: '#1a2a1f', water: '#13263a', roads: '#3a3a4a', roadWidth: 1, buildings: '#23232f' },
  daylight: { background: '#f2f0eb', earth: '#ece9e2', landuse: '#dcebd5', water: '#b8d4ea', roads: '#c9c5bd', roadWidth: 1.5, buildings: '#ddd8cf' },
} as const;

/**
 * A minimal Protomaps-style VECTOR basemap reading the festival's PMTiles archive
 * via the `pmtiles://` protocol. Deliberately small + standard-layer-named (the
 * Protomaps "basemap" vector schema: `earth`, `water`, `landuse`, `roads`,
 * `buildings`) so a standard Protomaps `.pmtiles` extract renders land/water/
 * roads/buildings without bundling a fonts/sprite server. Layers a vector source
 * lacks simply draw nothing — safe + graceful.
 *
 * `pmtilesUrl` is templated into the source `url` as `pmtiles://<url>`; the
 * caller is responsible for having validated it (https) upstream (schema +
 * host allowlist). No labels (text) layers — those need a glyphs endpoint we
 * don't host; geometry-only keeps the basemap fully self-contained.
 */
export function pmtilesVectorStyle(
  pmtilesUrl: string,
  attribution?: string,
  theme: ThemePreference = 'stage',
): MapStyleObject {
  const c = PMTILES_PALETTE[theme === 'daylight' ? 'daylight' : 'stage'];
  return {
    version: 8,
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${pmtilesUrl}`,
        attribution: attribution || '',
      },
    },
    layers: [
      // Solid backdrop so gaps in coverage read as a neutral field, not black.
      { id: 'background', type: 'background', paint: { 'background-color': c.background } },
      {
        id: 'earth',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'earth',
        paint: { 'fill-color': c.earth },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'landuse',
        paint: { 'fill-color': c.landuse },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'water',
        paint: { 'fill-color': c.water },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'protomaps',
        'source-layer': 'roads',
        paint: { 'line-color': c.roads, 'line-width': c.roadWidth },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'protomaps',
        'source-layer': 'buildings',
        paint: { 'fill-color': c.buildings },
      },
    ],
  };
}

/**
 * True when the festival map-config carries a usable offline vector basemap: an
 * https PMTiles URL. Anything else (absent config, non-https, empty) is false so
 * the caller keeps the online basemap (graceful fallback).
 */
export function hasOfflineBasemap(
  mapConfig: FestivalMapConfig | null | undefined,
): mapConfig is FestivalMapConfig & { offlineBasemap: { pmtilesUrl: string; attribution?: string } } {
  const url = mapConfig?.offlineBasemap?.pmtilesUrl;
  return typeof url === 'string' && /^https:\/\//i.test(url);
}

/**
 * Pick the MapLibre style for a festival: the PMTiles vector basemap when the
 * config carries a valid offline basemap, otherwise the themed OpenFreeMap style
 * URL. Pure + total — the renderer hands the result straight to
 * `new Map({ style })`, which accepts either a style object or a style URL.
 */
export function pickMapStyle(
  mapConfig: FestivalMapConfig | null | undefined,
  theme: ThemePreference = 'stage',
): MapStyleObject | string {
  if (hasOfflineBasemap(mapConfig)) {
    const { pmtilesUrl, attribution } = mapConfig.offlineBasemap;
    return pmtilesVectorStyle(pmtilesUrl, attribution, theme);
  }
  return openFreeMapStyleUrl(theme);
}

/**
 * The hostname of the festival's PMTiles URL, or null when there's no valid
 * offline basemap. Used by the native WebView's host allowlist + CSP to permit
 * EXACTLY the configured archive's origin (and nothing else) — preserving
 * default-deny. Returns null on any parse failure or non-https URL.
 */
export function pmtilesHost(mapConfig: FestivalMapConfig | null | undefined): string | null {
  if (!hasOfflineBasemap(mapConfig)) return null;
  try {
    const u = new URL(mapConfig.offlineBasemap.pmtilesUrl);
    return u.protocol === 'https:' ? u.hostname : null;
  } catch {
    return null;
  }
}
