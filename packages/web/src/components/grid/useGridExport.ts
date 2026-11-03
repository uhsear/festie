import { useCallback, useState } from 'react';
import type { RefObject } from 'react';
import { captureAndShareImage } from '../../lib/shareImage';
import { useToast } from '../../lib/toastContext';

/**
 * Encapsulates the grid-to-image export logic. Dynamically imports
 * html-to-image so the ~50 KB gzipped bundle only loads on demand.
 */
export function useGridExport(gridRef: RefObject<HTMLDivElement | null>, selectedDay: number, dayLabel: string) {
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  const exportGrid = useCallback(async () => {
    if (!gridRef.current || exporting) return;
    setExporting(true);
    // Normalize the resolved festival day label into a filename-safe slug for
    // the PNG name; the share title keeps the human-readable label.
    const daySlug =
      dayLabel
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `day-${selectedDay + 1}`;
    const el = gridRef.current;
    const dpr = Math.min(Math.max(Math.ceil(window.devicePixelRatio || 1), 2), 3);
    try {
      await captureAndShareImage(el, {
        width: el.scrollWidth,
        height: el.scrollHeight,
        filename: `festie-${daySlug}-grid.png`,
        title: `${dayLabel} Grid`,
        pixelRatio: dpr,
      });
    } catch (e: unknown) {
      console.error('Export failed', e);
      toast("Couldn't make the grid image. Try again.", 'error');
    } finally {
      setExporting(false);
    }
  }, [gridRef, selectedDay, dayLabel, exporting, toast]);

  return { exporting, exportGrid };
}
