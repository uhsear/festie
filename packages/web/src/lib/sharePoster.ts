/**
 * Captures a fixed 1080x1920 poster node to a PNG and hands it to the Web Share API, or
 * downloads it when file sharing is unavailable. Awaits document.fonts.ready so custom
 * fonts finish loading first (avoids the iOS Safari font-race that bakes fallback glyphs
 * into the PNG). html-to-image is dynamic-imported so it stays out of the /wrap chunk
 * until the user taps Share.
 */
export async function sharePoster(
  node: HTMLElement,
  fileName: string,
  title: string,
  toast: (message: string, type: 'success') => void,
): Promise<void> {
  if (document.fonts?.ready) await document.fonts.ready;
  await new Promise((r) => requestAnimationFrame(r));
  const { toBlob } = await import('html-to-image');
  const blob = await toBlob(node, {
    width: 1080,
    height: 1920,
    pixelRatio: 2,
    backgroundColor: '#080810',
    cacheBust: true,
  });
  if (!blob) throw new Error('Capture failed');
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title });
    return;
  }
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
  URL.revokeObjectURL(url);
  toast('Saved to downloads', 'success');
}
