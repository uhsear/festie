import { forwardRef, type ReactNode } from 'react';

const DEFAULT_WIDTH = 270;

/**
 * On-screen preview of the 1080x1920 share poster, scaled down. The ref points at the
 * unscaled poster node, so html-to-image captures the real artwork, not the preview.
 * The poster keeps its own dark palette in both themes.
 */
const PosterPreview = forwardRef<HTMLDivElement, { children: ReactNode; width?: number }>(function PosterPreviewInner(
  { children, width = DEFAULT_WIDTH },
  ref,
) {
  const scale = width / 1080;
  return (
    <figure className="m-0">
      <div
        aria-hidden="true"
        className="mx-auto overflow-hidden rounded-lg border border-border pointer-events-none"
        style={{ width, height: 1920 * scale }}
      >
        <div style={{ width: 1080, height: 1920, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          <div ref={ref}>{children}</div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-xs text-text-muted">This is the image you will share</figcaption>
    </figure>
  );
});

export default PosterPreview;
