// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, type MutableRefObject } from 'react';
import { amenityGlyph, humanizeAmenityType, type MapPin as Pin } from '@festie/shared/utils';
import type { GlMarker, GlRefObject, MapRefObject, MapStatus } from './mapDom';

/**
 * Amenity markers (festival-mapped; category glyph + color). Keyed off the
 * VISIBLE set so toggling a filter chip re-runs this effect (hide/show); the pin
 * array is read through a ref so the deps stay honest (`[status, amenitiesKey]`).
 * A tap or Enter/Space calls `onSelectPlace`; without it (authoring) the marker
 * adds no listener, so a tap still reaches the map click.
 */
export function useAmenityMarkers(
  mapRef: MapRefObject,
  glRef: GlRefObject,
  status: MapStatus,
  visibleAmenityPins: Pin[],
  amenitiesKey: string,
  markersRef: MutableRefObject<GlMarker[]>,
  onSelectPlace?: (pin: Pin) => void,
): void {
  const pinsRef = useRef(visibleAmenityPins);
  pinsRef.current = visibleAmenityPins;
  const selectRef = useRef(onSelectPlace);
  selectRef.current = onSelectPlace;

  useEffect(() => {
    const map = mapRef.current;
    const gl = glRef.current;
    if (status !== 'ready' || !map || !gl) return;

    for (const m of markersRef.current) m.remove();
    markersRef.current = [];

    for (const p of pinsRef.current) {
      const { glyph, color } = amenityGlyph(p.amenityType);
      const el = document.createElement('div');
      el.className = 'festie-amenity-marker';
      el.style.setProperty('--amenity-color', color);
      el.setAttribute('aria-label', `${p.amenityType ? humanizeAmenityType(p.amenityType) : 'Amenity'}: ${p.label}`);
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.textContent = glyph;
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
  }, [status, amenitiesKey, mapRef, glRef, markersRef]);
}
