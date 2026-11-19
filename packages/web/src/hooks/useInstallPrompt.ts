import { useEffect, useState } from 'react';

/**
 * Captures the browser's `beforeinstallprompt` event on window so any install
 * button can trigger it, and mirrors availability in state. Returns the flag
 * and a setter for callers that consume the prompt. `onCapture` should be a
 * stable function; it runs each time a prompt is captured.
 */
export function useInstallPrompt(onCapture?: () => void) {
  const [available, setAvailable] = useState(() => Boolean(window.__festieInstallPrompt));

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      window.__festieInstallPrompt = e as BeforeInstallPromptEvent;
      setAvailable(true);
      onCapture?.();
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [onCapture]);

  return [available, setAvailable] as const;
}
