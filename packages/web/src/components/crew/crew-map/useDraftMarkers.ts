// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { colors } from '@festie/shared/tokens';
import type { GlMarker, GlRefObject, MapRefObject, MapStatus } from './mapDom';

type DraftPoint = { latitude: number; longitude: number };

/**
 * Draft authoring dots (web-parity with native OfflineMap). A small aqua dot at
 * each in-progress zone vertex / site-plan corner so taps give feedback below the
 * polygon/overlay render threshold. Re-rendered wholesale on each change (tiny N);
 * points read through a ref so deps stay honest (`[status, draftPointsKey]`).
 */
export function useDraftMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  draftPoints: DraftPoint[] | undefined,
  draftPointsKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
): void {
  const draftPointsRef = useRef(draftPoints);
  draftPointsRef.current = draftPoints;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    for (const p of draftPointsRef.current ?? []) {
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue;
      const el = document.createElement('div');
      el.style.cssText = [
        'width:12px',
        'height:12px',
        'border-radius:50%',
        `background:${colors.accent.aqua}`,
        'border:2px solid #fff',
        `box-shadow:0 0 6px ${colors.accent.aqua}`,
        'pointer-events:none',
      ].join(';');
      el.setAttribute('aria-hidden', 'true');
      const marker = new gl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map);
      markersRef.current.push(marker);
    }
  }, [status, draftPointsKey, mapRef, glRef, markersRef]);
}
