// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef } from 'react';
import { metersPerPixel, type Coord } from '@festie/shared/utils';
import type { GlMarker, GlRefObject, MapRefObject, MapStatus } from './mapDom';

const MAX_RING_PX = 400;

function ringDiameterPx(accuracyM: number | null, latitude: number, zoom: number): number | null {
  if (accuracyM == null) return null;
  const mpp = metersPerPixel(latitude, zoom);
  if (!Number.isFinite(mpp) || mpp <= 0) return null;
  return Math.min(MAX_RING_PX, (2 * accuracyM) / mpp);
}

function selfLabel(accuracyM: number | null): string {
  return accuracyM == null ? 'You are here' : `You are here, accurate to about ${Math.round(accuracyM)} m`;
}

/**
 * The "you are here" dot with an accuracy ring. One DOM marker is created on the
 * first fix and moved with `setLngLat` afterwards; the ring is resized on each
 * fix and on map zoom. Removed when `enabled` turns false or the map goes away.
 */
export function useSelfMarker(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  selfCoord: Coord | null,
  accuracyM: number | null,
  enabled: boolean,
): void {
  const markerRef = useRef<GlMarker | null>(null);
  const ringRef = useRef<HTMLElement | null>(null);
  const dotRef = useRef<HTMLElement | null>(null);
  const fixRef = useRef({ selfCoord, accuracyM });
  fixRef.current = { selfCoord, accuracyM };

  const active = enabled && status === 'ready' && selfCoord != null;

  // Create / destroy the marker and follow zoom.
  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    const fix = fixRef.current.selfCoord;
    if (!active || !map || !gl || !fix) return;

    const el = document.createElement('div');
    el.className = 'festie-self-marker';
    el.setAttribute('role', 'img');
    const ring = document.createElement('span');
    ring.className = 'festie-self-accuracy';
    el.appendChild(ring);
    const marker = new gl.Marker({ element: el }).setLngLat([fix.longitude, fix.latitude]).addTo(map);
    markerRef.current = marker;
    ringRef.current = ring;
    dotRef.current = el;

    const sizeRing = () => {
      const f = fixRef.current;
      if (!f.selfCoord) return;
      const px = ringDiameterPx(f.accuracyM, f.selfCoord.latitude, map.getZoom());
      ring.style.display = px == null ? 'none' : '';
      if (px != null) {
        ring.style.inlineSize = `${px}px`;
        ring.style.blockSize = `${px}px`;
      }
    };
    sizeRing();
    map.on('zoom', sizeRing);

    return () => {
      map.off?.('zoom', sizeRing);
      marker.remove();
      markerRef.current = null;
      ringRef.current = null;
      dotRef.current = null;
    };
  }, [active, mapRef, glRef]);

  // Follow each new fix without rebuilding the marker.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!active || !map || !marker || !selfCoord) return;
    marker.setLngLat([selfCoord.longitude, selfCoord.latitude]);
    dotRef.current?.setAttribute('aria-label', selfLabel(accuracyM));
    const ring = ringRef.current;
    if (!ring) return;
    const px = ringDiameterPx(accuracyM, selfCoord.latitude, map.getZoom());
    ring.style.display = px == null ? 'none' : '';
    if (px != null) {
      ring.style.inlineSize = `${px}px`;
      ring.style.blockSize = `${px}px`;
    }
  }, [active, selfCoord, accuracyM, mapRef]);
}
