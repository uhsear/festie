import { useCallback, useState } from 'react';
import type { RefObject } from 'react';

/**
 * Encapsulates the grid-to-image export logic. Dynamically imports
 * html-to-image so the ~50 KB gzipped bundle only loads on demand.
 */
export function useGridExport(gridRef: RefObject<HTMLDivElement | null>, selectedDay: number, dayLabel: string) {
  const [exporting, setExporting] = useState(false);

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
      if (document.fonts?.ready) await document.fonts.ready;

      const { toBlob } = await import('html-to-image');
      const blob = await toBlob(el, {
        backgroundColor: '#080810',
        pixelRatio: dpr,
        width: el.scrollWidth,
        height: el.scrollHeight,
        cacheBust: true,
      });
      if (!blob) throw new Error('Capture failed');

      const filename = `festie-${daySlug}-grid.png`;
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${dayLabel} Grid` });
      } else {
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: filename });
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: unknown) {
      const isAbort = e instanceof DOMException && e.name === 'AbortError';
      if (!isAbort) console.error('Export failed', e);
    } finally {
      setExporting(false);
    }
  }, [gridRef, selectedDay, dayLabel, exporting]);

  return { exporting, exportGrid };
}
