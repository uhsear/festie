// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Share2, X } from 'lucide-react';
import { useFestivalStore, useCrewStore, useAuthStore } from '@festie/shared/stores';
import { fetchShareLink } from '@festie/shared/services';
import {
  encodePlanSnapshot,
  buildPlanSnapshotInput,
  buildPlanQrUrl,
  MAX_ENCODED_LENGTH,
} from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import type { Priority } from '@festie/shared/types';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

const NO_PROFILE_TEXT = 'Pick a set at this festival first, then share your picks.';
const OFFLINE_TEXT = 'Connect to the internet to get your link. Share by QR works offline.';

type LinkState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

/** "Send a link" section: a revocable `/s/<token>` URL with Share, Copy and Open. */
function LinkSection({ festivalId, festivalName }: { festivalId: string; festivalName: string }) {
  const [state, setState] = useState<LinkState>({ status: 'loading' });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchShareLink(festivalId, window.location.origin).then(
      ({ url }) => {
        if (!cancelled) setState({ status: 'ready', url });
      },
      (err: unknown) => {
        if (cancelled) return;
        const notFound = (err as { status?: number } | null)?.status === 404;
        setState({ status: 'error', message: notFound ? NO_PROFILE_TEXT : OFFLINE_TEXT });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const share = async (url: string) => {
    const text = `My ${festivalName} picks on Festie`;
    try {
      await navigator.share({ title: text, text, url });
    } catch (err) {
      // AbortError = user dismissed the sheet.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setState({ status: 'error', message: OFFLINE_TEXT });
      }
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the URL stays selectable in the <code> block.
    }
  };

  return (
    <section className="space-y-2" aria-labelledby="share-link-heading">
      <h3 id="share-link-heading" className="text-sm font-semibold text-text-primary">
        Send a link
      </h3>
      <p className="text-sm text-text-secondary">
        Anyone with this link can see your {festivalName} picks. It stays up to date as you change them.
      </p>
      {state.status === 'loading' && <p className="text-sm text-text-muted">Getting your link…</p>}
      {state.status === 'error' && (
        <p className="text-sm text-text-secondary" data-testid="share-link-error">
          {state.message}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <code className="block truncate rounded-lg bg-bg-elevated px-3 py-2 text-xs text-text-primary" data-testid="share-link-url">
            {state.url}
          </code>
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <Button variant="secondary" size="sm" type="button" onClick={() => share(state.url)}>
                Share
              </Button>
            )}
            <Button variant="secondary" size="sm" type="button" onClick={() => copy(state.url)}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <a
              href={state.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-text-primary"
            >
              Open
            </a>
          </div>
        </>
      )}
    </section>
  );
}

/** "Share by QR" section: the plan snapshot as a URL a phone camera can open. Offline-native. */
function QrSection() {
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const meetingPoints = useCrewStore((s) => s.meetingPoints);

  const qr = useMemo(() => {
    if (!currentFestival || !currentProfile) return null;
    const { input } = buildPlanSnapshotInput({
      festival: { id: currentFestival.id, name: currentFestival.name },
      picks: currentProfile.picks as Record<string, Priority> | undefined,
      meetingPoints,
      nowMs: Date.now(),
    });
    const encoded = encodePlanSnapshot(input);
    return { encoded, tooLong: encoded.length > MAX_ENCODED_LENGTH };
  }, [currentFestival, currentProfile, meetingPoints]);

  return (
    <section className="space-y-3" aria-labelledby="share-qr-heading">
      <h3 id="share-qr-heading" className="text-sm font-semibold text-text-primary">
        {COPY.picks.shareByQr}
      </h3>
      {!qr || qr.tooLong ? (
        <p className="text-sm text-text-secondary" data-testid="plan-qr-too-large">
          This plan is too big to fit in one QR code. Trim a few picks and try again — a QR code can only hold so much.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-text-secondary text-center">
            Point any phone camera here to open these picks in a browser.
          </p>
          {/* High-contrast dark-on-white tile so cameras lock fast in low festival light. */}
          <div
            className="rounded-xl bg-white p-4"
            data-testid="plan-qr-code"
            role="img"
            aria-label="QR code that opens your picks in a browser"
          >
            <QRCodeSVG
              value={buildPlanQrUrl(qr.encoded, window.location.origin)}
              size={200}
              level="M"
              fgColor="#080810"
              bgColor="#FFFFFF"
              marginSize={0}
            />
          </div>
          <p className="text-xs text-text-muted text-center">
            Friends with Festie can scan it in Share picks › Scan QR, then choose which picks to add. Works offline —
            nothing is sent over the internet. It's a snapshot, not a live link.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * The one "Share picks" entry on web: a revocable link, a QR that opens in any
 * phone camera, and the public page status. Radix Dialog, same primitive as
 * ConfirmDialog.
 */
export default function SharePicksDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const publicSchedule = useAuthStore((s) => s.user?.publicSchedule) === true;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="sm" type="button" className={className} aria-label="Share my picks">
          <Share2 className="w-4 h-4" aria-hidden="true" />
          {COPY.picks.share}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[92vw] max-w-sm max-h-[90vh] overflow-y-auto -translate-x-1/2 -translate-y-1/2
                     rounded-2xl bg-bg-card border border-border-light shadow-2xl p-5 space-y-5
                     data-[state=open]:animate-in data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-bold text-text-primary">
              {currentFestival ? `Share your ${currentFestival.name} picks` : COPY.picks.share}
            </Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-5 h-5" />} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Send a link to your picks or show a QR code.
          </Dialog.Description>

          {currentFestival && <LinkSection festivalId={currentFestival.id} festivalName={currentFestival.name} />}
          <QrSection />

          <p className="text-sm text-text-secondary">
            {publicSchedule
              ? 'Public schedule page is on. It shows your newest festival.'
              : 'Public schedule page is off.'}{' '}
            <Link to="/account" className="underline text-text-primary" onClick={() => setOpen(false)}>
              Change in Account
            </Link>
          </p>
          <p className="text-xs text-text-muted">
            Sent a link by mistake?{' '}
            <Link to="/account" className="underline text-text-primary" onClick={() => setOpen(false)}>
              Reset your links in Account
            </Link>
            .
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
