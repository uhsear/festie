import { useEffect, useRef, useState } from 'react';

/**
 * With vite-plugin-pwa configured as `registerType: 'autoUpdate'`, the
 * service worker uses skipWaiting + clientsClaim to activate immediately.
 * A `controllerchange` after the page already had a controller means a new
 * build is live. We show a bar instead of reloading, so a deploy never wipes
 * what the user is typing. The first install also fires `controllerchange`
 * (clientsClaim); that case is ignored.
 */
export default function UpdatePrompt() {
  const [updateReady, setUpdateReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const updateReadyRef = useRef(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const hadController = !!navigator.serviceWorker.controller;

    const handleControllerChange = () => {
      if (!hadController) return;
      updateReadyRef.current = true;
      setUpdateReady(true);
    };

    // After a deploy, old lazy route chunks are gone. The user is leaving that
    // screen anyway, so reload instead of showing a broken route.
    const handlePreloadError = (event: Event) => {
      if (!updateReadyRef.current) return;
      event.preventDefault();
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    window.addEventListener('vite:preloadError', handlePreloadError);

    // Periodic update check so long-lived tabs pick up new SWs.
    const checkForUpdates = async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.update();
      } catch (err) {
        console.error('SW update check failed:', err);
      }
    };
    checkForUpdates();
    const interval = setInterval(checkForUpdates, 60000);

    return () => {
      clearInterval(interval);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      window.removeEventListener('vite:preloadError', handlePreloadError);
    };
  }, []);

  if (!updateReady || dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(var(--bottom-nav-h,0px)+12px)] z-50 flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-2 text-sm text-text-primary shadow-lg"
    >
      <span>A new version of Festie is ready.</span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-[44px] min-w-[44px] rounded-lg px-3 text-text-secondary"
        >
          Later
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-[44px] min-w-[44px] rounded-lg bg-accent-aqua px-3 font-semibold text-text-on-accent"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
