// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Share2 } from 'lucide-react';
import { useFestivalStore, useCrewStore, useAuthStore } from '@festie/shared/stores';
import { fetchShareLink } from '@festie/shared/services';
import { encodePlanSnapshot, buildPlanSnapshotInput, buildPlanQrUrl, MAX_ENCODED_LENGTH } from '@festie/shared/utils';
import { COPY } from '@festie/shared/constants';
import { useToast } from '../../lib/toastContext';
import type { Priority } from '@festie/shared/types';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';

const NO_PROFILE_TEXT = 'Pick a set at this festival first, then share your picks.';
const OFFLINE_TEXT = 'Connect to the internet to get your link. Share by QR works offline.';

type LinkState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string };

/** "Send a link" section: a revocable `/s/<token>` URL with Share, Copy and Open. */
function LinkSection({ festivalId, festivalName }: { festivalId: string; festivalName: string }) {
  const [state, setState] = useState<LinkState>({ status: 'loading' });
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

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
      // AbortError = user dismissed the sheet. Any other failure keeps the link on screen: Copy and Open still work.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        toast("Couldn't open the share sheet. Copy the link instead.", 'error');
      }
    }
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't copy the link. Select it and copy it by hand.", 'error');
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
          <code
            className="block truncate rounded-xl bg-bg-elevated px-3 py-2 text-xs text-text-primary"
            data-testid="share-link-url"
          >
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
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-border px-3 text-sm font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2"
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
  const activeCrew = useCrewStore((s) => s.activeCrew);

  const qr = useMemo(() => {
    if (!currentFestival || !currentProfile) return null;
    const { input } = buildPlanSnapshotInput({
      festival: { id: currentFestival.id, name: currentFestival.name },
      picks: currentProfile.picks as Record<string, Priority> | undefined,
      meetingPoints,
      planB: activeCrew?.festivalId === currentFestival.id ? activeCrew.homeBasePlanB : null,
      nowMs: Date.now(),
    });
    const encoded = encodePlanSnapshot(input);
    return { encoded, tooLong: encoded.length > MAX_ENCODED_LENGTH };
  }, [currentFestival, currentProfile, meetingPoints, activeCrew]);

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
            className="rounded-lg bg-white p-4"
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
    <>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        className={className}
        onClick={() => setOpen(true)}
      >
        <Share2 className="w-4 h-4" aria-hidden="true" />
        {COPY.picks.share}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={currentFestival ? `Share your ${currentFestival.name} picks` : COPY.picks.share}
        description="Send a link to your picks or show a QR code."
        hideDescription
      >
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
      </Dialog>
    </>
  );
}
