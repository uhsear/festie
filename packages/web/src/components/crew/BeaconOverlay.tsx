// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAuthStore } from '@festie/shared/stores';
import { BEACON_COPY } from '@festie/shared/constants';
import { BEACON_FLASH_MS, beaconColors, displayInitials, identityLabel } from '@festie/shared/utils';
import Button from '../ui/Button';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function useReducedMotion() {
  return useSyncExternalStore(
    (cb) => {
      const mql = typeof window !== 'undefined' ? window.matchMedia(REDUCED_MOTION) : null;
      mql?.addEventListener('change', cb);
      return () => mql?.removeEventListener('change', cb);
    },
    () => typeof window !== 'undefined' && window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

// Fullscreen and wake lock are best effort: either may be missing or refused.
function useScreenHold() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let released = false;
    try {
      void document.documentElement.requestFullscreen?.()?.catch(() => {});
    } catch {
      // Fullscreen refused: the overlay still fills the viewport.
    }
    try {
      void navigator.wakeLock
        ?.request('screen')
        .then((l) => {
          if (released) void l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {});
    } catch {
      // Wake lock unsupported: the screen may dim.
    }
    return () => {
      released = true;
      void lock?.release().catch(() => {});
      try {
        if (document.fullscreenElement) void document.exitFullscreen?.()?.catch(() => {});
      } catch {
        // Already left fullscreen.
      }
    };
  }, []);
}

function BeaconScreen() {
  const user = useAuthStore((s) => s.user);
  const reducedMotion = useReducedMotion();
  const [alt, setAlt] = useState(false);
  useScreenHold();

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => setAlt((a) => !a), BEACON_FLASH_MS);
    return () => clearInterval(id);
  }, [reducedMotion]);

  const label = user ? identityLabel(user) : 'Festie';
  const { primary, alternate } = beaconColors(label);
  const showAlt = alt && !reducedMotion;

  return (
    <Dialog.Content
      aria-label={BEACON_COPY.a11y}
      aria-describedby={undefined}
      style={{ backgroundColor: showAlt ? alternate : primary, color: showAlt ? primary : alternate }}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <Dialog.Title className="sr-only">{BEACON_COPY.a11y}</Dialog.Title>
      <p className="text-[min(40vw,16rem)] font-bold leading-none">{user ? displayInitials(user) : 'F'}</p>
      <p className="text-2xl font-bold">{label}</p>
      <p className="text-xl">{BEACON_COPY.prompt}</p>
      <p className="text-base">{BEACON_COPY.footer}</p>
      <Dialog.Close asChild>
        <Button variant="secondary" size="lg" className="min-h-14 min-w-40">
          {BEACON_COPY.done}
        </Button>
      </Dialog.Close>
    </Dialog.Content>
  );
}

/** Row button that opens a full-screen flashing colour so friends can spot you. Needs no GPS or signal. */
export function BeaconButton() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="outline" fullWidth className="!h-auto flex-col !items-start text-left py-2">
          <span className="font-semibold">{BEACON_COPY.button}</span>
          <span className="text-xs text-text-muted font-normal whitespace-normal">{BEACON_COPY.buttonHint}</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>{open && <BeaconScreen />}</Dialog.Portal>
    </Dialog.Root>
  );
}
