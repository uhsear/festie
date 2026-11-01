// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, X } from 'lucide-react';
import { raiseSos, sosErrorMessage, isApiClientError } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { inputBase } from '../../lib/styles';

interface Props {
  crewId: string;
  /** Small "SOS" button for headers. The default is the full-width button. */
  compact?: boolean;
  /** Pulse ring while a crew SOS is active (a static ring under reduced motion). */
  alerting?: boolean;
}

// Best-effort one-shot fix to attach to the SOS so the crew can actually find
// the person. Never blocks the raise — resolves undefined on denial/timeout.
function oneShotPosition(): Promise<{ lat: number; lng: number; accuracy?: number; capturedAt: string } | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? undefined,
          capturedAt: new Date(pos.timestamp).toISOString(),
        }),
      () => resolve(undefined),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 8_000 },
    );
  });
}

/**
 * The one SOS raise control: button + confirm dialog + optional message.
 * SOS is HTTP and online-only (never queued), so a failed raise tells the user
 * to reach their crew another way instead of silently queueing a stale rescue.
 */
export default function SosRaiseButton({ crewId, compact = false, alerting = false }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Reactively track prefers-reduced-motion so the ring class stays in sync
  // even if the OS setting changes while the button is mounted.
  const reducedMotion = useSyncExternalStore(
    (cb) => {
      const mql = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
      mql?.addEventListener('change', cb);
      return () => mql?.removeEventListener('change', cb);
    },
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      const position = await oneShotPosition();
      const text = message.trim();
      await raiseSos(crewId, { ...(text ? { message: text } : {}), ...(position ? { position } : {}) });
      toast('SOS sent to your crew', 'success');
      setOpen(false);
      setMessage('');
    } catch (err) {
      toast(sosErrorMessage(err, 'send'), 'error');
      // 429: the user's own SOS is already showing, so the dialog has nothing left to do.
      if (isApiClientError(err) && err.status === 429) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const ring = alerting ? (reducedMotion ? ' sos-fab-static-ring' : ' sos-fab-alerting') : '';

  return (
    <>
      {compact ? (
        <Button
          variant="danger"
          size="sm"
          onClick={() => setOpen(true)}
          className={`min-h-11${ring}`}
          aria-label="Send an SOS to your crew"
        >
          <AlertCircle className="w-4 h-4" aria-hidden="true" /> SOS
        </Button>
      ) : (
        <Button
          variant="danger"
          onClick={() => setOpen(true)}
          className={`w-full min-h-11${ring}`}
          aria-label="Send an SOS to your crew"
        >
          <AlertCircle className="w-4 h-4" aria-hidden="true" /> Send SOS
        </Button>
      )}

      <Dialog.Root open={open} onOpenChange={(o: boolean) => !busy && setOpen(o)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-2xl border border-border-light bg-bg-card p-5 shadow-2xl data-[state=open]:animate-in data-[state=open]:zoom-in-95">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="flex items-center gap-2 text-base font-bold text-text-primary">
                  <AlertCircle className="w-5 h-5 text-accent-coral" aria-hidden="true" /> Send an SOS to your crew?
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-sm text-text-secondary">
                  Everyone in this crew gets an alert with your last location so they can find you. Use this for
                  emergencies.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <IconButton label="Close" icon={<X className="w-5 h-5" />} disabled={busy} />
              </Dialog.Close>
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional: what's happening? (e.g. 'Lost near Main Stage')"
              maxLength={280}
              rows={3}
              aria-label="Optional SOS message"
              disabled={busy}
              className={`${inputBase} resize-none`}
            />

            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" type="button" className="flex-1 min-h-11" disabled={busy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button type="button" variant="danger" onClick={send} isLoading={busy} className="flex-1 min-h-11">
                {busy ? 'Sending…' : 'Send SOS'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
