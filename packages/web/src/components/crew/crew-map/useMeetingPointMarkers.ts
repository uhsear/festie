// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { MapPin as Pin } from '@festie/shared/utils';
import type { GlMarker, GlRefObject, MapRefObject, MapStatus } from './mapDom';

/**
 * Meeting-point markers. Rebuilt when the pins' coords change (via `pinsKey`);
 * the live pin array is read through a ref so the effect's deps stay honest
 * (`[status, pinsKey]`) without an exhaustive-deps suppression. A tap or
 * Enter/Space calls `onSelectPlace`; without it (authoring) the marker adds no
 * listener, so a tap still reaches the map click.
 */
export function useMeetingPointMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  pins: Pin[],
  pinsKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
  onSelectPlace?: (pin: Pin) => void,
): void {
  const pinsRef = useRef(pins);
  pinsRef.current = pins;
  const selectRef = useRef(onSelectPlace);
  selectRef.current = onSelectPlace;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const p of pinsRef.current) {
      const el = document.createElement('div');
      el.className = 'festie-map-marker';
      // a11y: each marker is a div MapLibre positions over the canvas. Expose it
      // as a focusable button announcing the meeting point.
      el.setAttribute('aria-label', p.label + (p.sublabel ? ' - ' + p.sublabel : ''));
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      const marker = new gl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map);
      if (selectRef.current) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          selectRef.current?.(p);
        });
        // MapLibre only wires click; bridge Enter/Space for keyboard users.
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectRef.current?.(p);
          }
        });
      }
      markersRef.current.push(marker);
    }
  }, [status, pinsKey, mapRef, glRef, markersRef]);
}
