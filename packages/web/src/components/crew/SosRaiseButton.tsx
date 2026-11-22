// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { AlertCircle } from 'lucide-react';
import { raiseSos, sosErrorMessage, isApiClientError } from '@festie/shared';
import { toSosPosition } from '@festie/shared/services';
import type { SosPosition } from '@festie/shared/services';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { inputBase } from '../../lib/styles';

interface Props {
  crewId: string;
  /** Small "SOS" button for headers. The default is the full-width button. */
  compact?: boolean;
  /** Pulse ring while a crew SOS is active (a static ring under reduced motion). */
  alerting?: boolean;
}

// Best-effort one-shot fix to attach to the SOS so the crew can actually find
// the person. Never blocks the raise: a cached fix returns at once and the whole
// wait is capped at SOS_FIX_BUDGET_MS, because the geolocation timeout only
// starts after the permission prompt is answered. Matches mobile's budget.
const SOS_FIX_BUDGET_MS = 4_000;
function oneShotPosition(): Promise<SosPosition | undefined> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(undefined);
    const budget = setTimeout(() => resolve(undefined), SOS_FIX_BUDGET_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(budget);
        resolve(toSosPosition(pos));
      },
      () => {
        clearTimeout(budget);
        resolve(undefined);
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: SOS_FIX_BUDGET_MS },
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
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  async function send() {
    if (busy) return;
    setBusy(true);
    try {
      const position = await oneShotPosition();
      const text = message.trim();
      await raiseSos(crewId, { ...(text ? { message: text } : {}), ...(position ? { position } : {}) });
      // Same honesty as mobile: without a fix the crew was alerted but cannot see where.
      if (position) toast('SOS sent to your crew', 'success');
      else toast('SOS sent without your location. Your crew was alerted; tell them where you are.', 'warning');
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
          aria-label="Send SOS to your crew"
        >
          <AlertCircle className="w-4 h-4" aria-hidden="true" /> Send SOS
        </Button>
      )}

      <Dialog
        open={open}
        onOpenChange={(o) => !busy && setOpen(o)}
        icon={<AlertCircle className="w-5 h-5 text-accent-coral" aria-hidden="true" />}
        title="Send an SOS to your crew?"
        description="Everyone in this crew gets an alert with your last location so they can find you. Use this for emergencies."
        closeDisabled={busy}
      >
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
          <RadixDialog.Close asChild>
            <Button variant="secondary" type="button" className="flex-1 min-h-11" disabled={busy}>
              Cancel
            </Button>
          </RadixDialog.Close>
          <Button type="button" variant="danger" onClick={send} isLoading={busy} className="flex-1 min-h-11">
            {busy ? 'Sending…' : 'Send SOS'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
