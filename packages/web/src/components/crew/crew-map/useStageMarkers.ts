// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { MapPin as Pin } from '@festie/shared/utils';
import type { GlMarker, GlRefObject, MapRefObject, MapStatus } from './mapDom';

/**
 * Stage markers (festival-mapped; stage-colored, labelled). Rebuilt when a
 * stage's coord/color changes (via `stagesKey`); the pin array is read through a
 * ref so the deps stay honest (`[status, stagesKey]`). A tap or Enter/Space calls
 * `onSelectPlace`; without it (authoring) the marker adds no listener, so a tap
 * still reaches the map click.
 */
export function useStageMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  stagePins: Pin[],
  stagesKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
  onSelectPlace?: (pin: Pin) => void,
): void {
  const stagePinsRef = useRef(stagePins);
  stagePinsRef.current = stagePins;
  const selectRef = useRef(onSelectPlace);
  selectRef.current = onSelectPlace;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const p of stagePinsRef.current) {
      const el = document.createElement('div');
      el.className = 'festie-stage-marker';
      // Tint the marker with the stage's own brand color (falls back to the CSS
      // default in the stylesheet when absent).
      if (p.color) el.style.setProperty('--stage-color', p.color);
      el.setAttribute('aria-label', `Stage: ${p.label}`);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      // A small always-on label tag so stages read at a glance, distinct from the
      // coral meeting dots + aqua peer discs. Text via textContent (injection-safe).
      const tag = document.createElement('span');
      tag.className = 'festie-stage-tag';
      tag.textContent = p.label;
      el.appendChild(tag);
      const marker = new gl.Marker({ element: el }).setLngLat([p.longitude, p.latitude]).addTo(map);
      if (selectRef.current) {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          selectRef.current?.(p);
        });
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectRef.current?.(p);
          }
        });
      }
      markersRef.current.push(marker);
    }
  }, [status, stagesKey, mapRef, glRef, markersRef]);
}
