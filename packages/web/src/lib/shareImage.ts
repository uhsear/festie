interface ShareImageOptions {
  width: number;
  height: number;
  filename: string;
  title: string;
  backgroundColor?: string;
  pixelRatio?: number;
}

/**
 * Captures a fixed-size node to a PNG, then opens the share sheet when files can be shared,
 * else downloads it. Waits for fonts so iOS Safari does not render fallback glyphs.
 */
export async function captureAndShareImage(
  el: HTMLElement,
  opts: ShareImageOptions,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(r));
  const { toBlob } = await import('html-to-image');
  const blob = await toBlob(el, {
    width: opts.width,
    height: opts.height,
    pixelRatio: opts.pixelRatio ?? 1,
    backgroundColor: opts.backgroundColor ?? '#080810',
    cacheBust: true,
  });
  if (!blob) throw new Error('Capture failed');
  const file = new File([blob], opts.filename, { type: 'image/png' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: opts.title });
      return 'shared';
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: opts.filename });
    a.click();
    URL.revokeObjectURL(url);
    return 'downloaded';
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}
