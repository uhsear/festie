import { forwardRef, type ReactNode } from 'react';

const SCALE = 0.25;

/**
 * On-screen preview of the 1080x1920 share poster, scaled down. The ref points at the
 * unscaled poster node, so html-to-image captures the real artwork, not the preview.
 * The poster keeps its own dark palette in both themes.
 */
const PosterPreview = forwardRef<HTMLDivElement, { children: ReactNode }>(function PosterPreviewInner(
  { children },
  ref,
) {
  return (
    <figure className="m-0 text-center">
      <div
        aria-hidden="true"
        className="mx-auto overflow-hidden rounded-xl border border-border pointer-events-none"
        style={{ width: 1080 * SCALE, height: 1920 * SCALE }}
      >
        <div style={{ width: 1080, height: 1920, transform: `scale(${SCALE})`, transformOrigin: 'top left' }}>
          <div ref={ref}>{children}</div>
        </div>
      </div>
      <figcaption className="mt-2 text-xs text-text-muted">This is the image you will share</figcaption>
    </figure>
  );
});

export default PosterPreview;
