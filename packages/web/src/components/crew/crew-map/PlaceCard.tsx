// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  MAP_COPY,
  locationPromptCopy,
  placeShareText,
  placeWalkLine,
  type Coord,
  type GeoState,
  type MapPlace,
} from '@festie/shared/utils';
import Button from '../../ui/Button';

interface Props {
  place: MapPlace;
  selfCoord: Coord | null;
  geoState: GeoState;
  onShowWay: () => void;
  /** Present only when the caller can create a meeting point (crew members). */
  onSetMeetingPoint?: (place: MapPlace) => void;
  /** Start or retry location from the "turn on location" line. */
  onLocate: () => void;
  onClose: () => void;
}

/**
 * Place card: what a tapped stage, amenity or meeting point is, how far it is, and
 * what to do next. A non-modal dialog that shares the pursue bar's slot on the map.
 * Three plain sibling lines (name, kind, walk) so a later line can slot in between.
 */
export default function PlaceCard({
  place,
  selfCoord,
  geoState,
  onShowWay,
  onSetMeetingPoint,
  onLocate,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [copyState, setCopyState] = useState<'copied' | 'failed' | null>(null);

  useEffect(() => {
    cardRef.current?.querySelector<HTMLButtonElement>('[data-show-way]')?.focus();
  }, [place.kind, place.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copyState) return;
    const t = setTimeout(() => setCopyState(null), 2000);
    return () => clearTimeout(t);
  }, [copyState]);

  const share = async () => {
    const text = placeShareText(place);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text });
      } catch {
        // The user cancelled the share sheet: nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch (err) {
      console.warn('Could not copy the place link', err);
      setCopyState('failed');
    }
  };

  const walkLine = placeWalkLine(selfCoord, place);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={place.name}
      className="absolute left-2 right-2 bottom-9 z-10 rounded-xl border bg-bg-elevated/95 px-3 py-2 shadow-lg"
      style={{ borderColor: 'var(--color-accent-aqua)' }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-text-primary">{place.name}</p>
          <p className="text-xs text-text-secondary">{place.kindLabel}</p>
          {walkLine ? (
            <p className="text-xs text-text-secondary">{walkLine}</p>
          ) : (
            <button
              type="button"
              onClick={onLocate}
              className="text-left text-xs text-accent-aqua underline-offset-2 hover:underline"
            >
              {locationPromptCopy(geoState)}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 min-h-11 min-w-11 inline-flex items-center justify-center text-text-muted hover:text-text-primary"
          aria-label={MAP_COPY.close}
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button data-show-way size="sm" className="min-h-11" onClick={onShowWay}>
          {MAP_COPY.showWay}
        </Button>
        {onSetMeetingPoint && place.kind !== 'meeting-point' && (
          <Button variant="secondary" size="sm" className="min-h-11" onClick={() => onSetMeetingPoint(place)}>
            {MAP_COPY.setMeetingPoint}
          </Button>
        )}
        <Button variant="secondary" size="sm" className="min-h-11" onClick={share}>
          {MAP_COPY.share}
        </Button>
        {copyState && (
          <span role="status" className="text-xs text-text-secondary">
            {copyState === 'copied' ? MAP_COPY.copied : MAP_COPY.copyFailed}
          </span>
        )}
      </div>
    </div>
  );
}
