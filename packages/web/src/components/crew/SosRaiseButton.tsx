// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { AlertCircle } from 'lucide-react';
import { raiseSos, sosErrorMessage, isApiClientError } from '@festie/shared';
import { toSosPosition } from '@festie/shared/services';
import { SOS_CONTROL } from '@festie/shared/constants';
import type { SosPosition } from '@festie/shared/services';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { inputBase } from '../../lib/styles';

interface Props {
  crewId: string;
  /** Pulse ring while a crew SOS is active (a static ring under reduced motion). */
  alerting?: boolean;
}

const HINT_MS = 2500;
const RING_R = 29;
const RING_LENGTH = 2 * Math.PI * RING_R;

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
 * The one SOS raise control: a round press-and-hold button + confirm dialog + optional message.
 * A pointer press fills the ring and opens the dialog after SOS_CONTROL.holdMs. A click that
 * the keyboard or a screen reader makes (detail 0) opens the same dialog at once.
 * SOS is HTTP and online-only (never queued), so a failed raise tells the user
 * to reach their crew another way instead of silently queueing a stale rescue.
 */
export default function SosRaiseButton({ crewId, alerting = false }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Reactively track prefers-reduced-motion so the ring class stays in sync
  // even if the OS setting changes while the button is mounted.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opened = useRef(false);
  const describedBy = useId();

  useEffect(() => () => clearTimeout(holdTimer.current), []);
  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(id);
  }, [hint]);

  function startHold(e: PointerEvent<HTMLButtonElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    opened.current = false;
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      opened.current = true;
      setHolding(false);
      setOpen(true);
    }, SOS_CONTROL.holdMs);
  }

  function cancelHold() {
    clearTimeout(holdTimer.current);
    setHolding(false);
  }

  function onTriggerClick(e: MouseEvent<HTMLButtonElement>) {
    // Keyboard and screen-reader activation click with detail 0: no hold needed.
    if (e.detail === 0) return setOpen(true);
    // A pointer press that was released early only explains the hold.
    if (!opened.current) setHint(true);
    opened.current = false;
  }

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
      <span className="relative inline-flex flex-col items-end gap-2">
        {hint && (
          <span
            role="status"
            className="absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-bg-elevated px-3 py-1.5 type-caption text-text-primary shadow-lg"
          >
            {SOS_CONTROL.tapHint}
          </span>
        )}
        <button
          type="button"
          data-testid="sos-control"
          aria-label={SOS_CONTROL.name}
          aria-describedby={describedBy}
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerCancel={cancelHold}
          onPointerLeave={cancelHold}
          onContextMenu={(e) => e.preventDefault()}
          onClick={onTriggerClick}
          className={`relative flex h-16 w-16 select-none touch-none flex-col items-center justify-center rounded-full bg-accent-coral-strong text-text-on-accent shadow-lg hover:bg-[var(--color-accent-coral-strong-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary${ring}`}
        >
          <svg className="pointer-events-none absolute inset-0 -rotate-90" viewBox="0 0 64 64" aria-hidden="true">
            <circle
              cx="32"
              cy="32"
              r={RING_R}
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={holding ? 0 : RING_LENGTH}
              style={{ transition: holding && !reducedMotion ? `stroke-dashoffset ${SOS_CONTROL.holdMs}ms linear` : 'none' }}
            />
          </svg>
          <AlertCircle className="h-5 w-5" aria-hidden="true" />
          <span className="type-label font-bold leading-none" aria-hidden="true">
            SOS
          </span>
        </button>
        <span id={describedBy} className="sr-only">
          {SOS_CONTROL.hint}
        </span>
      </span>

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
