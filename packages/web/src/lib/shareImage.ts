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

interface ShareImagesOptions extends Omit<ShareImageOptions, 'filename'> {
  filenames: string[];
}

/**
 * Captures several fixed-size nodes to PNGs, then shares them in one share sheet when files can be
 * shared, else downloads them one by one. Embeds the web fonts once (not per node).
 */
export async function captureAndShareImages(
  els: HTMLElement[],
  opts: ShareImagesOptions,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(r));
  const { toBlob, getFontEmbedCSS } = await import('html-to-image');
  const fontEmbedCSS = els[0] ? await getFontEmbedCSS(els[0]) : '';
  const files: File[] = [];
  for (const [i, el] of els.entries()) {
    const blob = await toBlob(el, {
      width: opts.width,
      height: opts.height,
      pixelRatio: opts.pixelRatio ?? 1,
      backgroundColor: opts.backgroundColor ?? '#080810',
      cacheBust: true,
      fontEmbedCSS,
    });
    if (!blob) throw new Error('Capture failed');
    files.push(new File([blob], opts.filenames[i] ?? `festie-${i + 1}.png`, { type: 'image/png' }));
  }
  try {
    if (navigator.canShare?.({ files })) {
      await navigator.share({ files, title: opts.title });
      return 'shared';
    }
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
      a.click();
      URL.revokeObjectURL(url);
    }
    return 'downloaded';
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    throw e;
  }
}
