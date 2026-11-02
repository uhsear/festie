import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { Check, Copy, Lock, QrCode, RefreshCw, Share2 } from 'lucide-react';
import { useCrewStore } from '@festie/shared/stores';
import { COPY } from '@festie/shared/constants';
import { buildJoinUrl, formatInviteExpiry, inviteShareMessage } from '@festie/shared/utils';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Switch from '../ui/Switch';
import { useToast } from '../../lib/toastContext';

// Lazy: keeps qrcode.react out of the crew route chunk until someone opens the QR.
const InviteQRDialog = lazy(() => import('./InviteQRDialog'));

interface CrewInviteBarProps {
  inviteCode: string;
  crewId: string;
  crewName: string;
  isOwner: boolean;
  /** ISO timestamp from the crew's `inviteExpiresAt`; omitted when the invite does not expire. */
  expiresAt?: string | null;
}

export default function CrewInviteBar({ inviteCode, crewId, crewName, isOwner, expiresAt }: CrewInviteBarProps) {
  const { toast, toastError } = useToast();
  const regenerateInvite = useCrewStore((s) => s.regenerateInvite);
  const setCrewLocked = useCrewStore((s) => s.setCrewLocked);
  const inviteLocked = useCrewStore((s) => s.activeCrew?.id === crewId && !!s.activeCrew.inviteLocked);
  const [lockBusy, setLockBusy] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    const url = buildJoinUrl(inviteCode, window.location.origin);
    navigator.clipboard?.writeText(url);
    setCopiedCode(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedCode(false), 2000);
  }, [inviteCode]);

  const handleShare = useCallback(async () => {
    const url = buildJoinUrl(inviteCode, window.location.origin);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title: `Join ${crewName} on Festie`, text: inviteShareMessage(crewName), url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    handleCopy();
  }, [inviteCode, crewName, handleCopy]);

  const expiry = formatInviteExpiry(expiresAt);
  const expiryText = expiry === 'Expired' && !isOwner ? 'Expired. Ask the crew owner for a new link.' : expiry;
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleRegenerate = useCallback(async () => {
    if (regenBusy) return;
    setRegenBusy(true);
    try {
      await regenerateInvite(crewId);
      toast('Invite code regenerated', 'success');
      setConfirmRegen(false);
    } catch (e) {
      toastError(e, "Couldn't regenerate the invite code. Try again.");
    } finally {
      setRegenBusy(false);
    }
  }, [crewId, regenBusy, regenerateInvite, toast, toastError]);

  const handleLockChange = useCallback(
    async (next: boolean) => {
      if (lockBusy) return;
      setLockBusy(true);
      try {
        await setCrewLocked(crewId, next);
        toast(next ? COPY.crewLock.locked : COPY.crewLock.unlocked, 'success');
      } catch (e) {
        toastError(e, COPY.crewLock.failed);
      } finally {
        setLockBusy(false);
      }
    },
    [crewId, lockBusy, setCrewLocked, toast, toastError],
  );

  return (
    <div className="py-1.5 px-2 rounded-lg bg-bg-card border border-border space-y-1.5">
    <div className="flex items-center gap-2">
      <Copy className="w-3.5 h-3.5 text-text-muted flex-shrink-0" aria-hidden="true" />
      <span className="text-xs text-text-secondary truncate">
        Invite: <span className="text-text-primary font-mono">{inviteCode}</span>
      </span>
      {expiryText && <span className="text-xs text-text-muted whitespace-nowrap">{expiryText}</span>}
      <div className="flex items-center gap-2 ml-auto flex-shrink-0">
        {isOwner && (
          <Button
            variant="outline"
            onClick={() => setConfirmRegen(true)}
            isLoading={regenBusy}
            aria-label="Regenerate invite code"
            className="!py-1 !px-2.5 min-w-11 text-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        )}
        {canNativeShare && (
          <Button
            variant="outline"
            onClick={handleShare}
            aria-label="Share invite link"
            className="!py-1 !px-2.5 min-w-11 text-xs"
          >
            <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setQrOpen(true)}
          aria-label="Show QR code"
          className="!py-1 !px-2.5 min-w-11 text-xs"
        >
          <QrCode className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant={copiedCode ? 'primary' : 'outline'}
          onClick={handleCopy}
          className={`!py-1 !px-2.5 text-xs ${copiedCode ? 'animate-[crew-copy-pulse_260ms_var(--ease-out,ease-out)] motion-reduce:!animate-none' : ''}`}
        >
          {copiedCode ? <><Check className="w-4 h-4" aria-hidden="true" /> Copied</> : 'Copy link'}
        </Button>
      </div>
    </div>
      {isOwner && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <span className="text-xs text-text-primary">
              {COPY.crewLock.label}
            </span>
            <p className="text-xs text-text-muted">{COPY.crewLock.hint}</p>
          </div>
          <Switch
            checked={inviteLocked}
            onChange={handleLockChange}
            label={COPY.crewLock.label}
            disabled={lockBusy}
            data-testid="crew-lock-switch"
          />
        </div>
      )}
      <div role="status">
        {inviteLocked && (
          <p className="text-xs text-text-secondary inline-flex items-center gap-1">
            <Lock className="w-3 h-3" aria-hidden="true" />
            {COPY.crewLock.lockedLine}
          </p>
        )}
      </div>
      {qrOpen && (
        <Suspense fallback={null}>
          <InviteQRDialog open={qrOpen} onOpenChange={setQrOpen} crewName={crewName} code={inviteCode} />
        </Suspense>
      )}
      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="Regenerate invite code?"
        description="The current code stops working. Anyone with the old link will need the new one."
        confirmLabel="Regenerate"
        destructive
        busy={regenBusy}
        onConfirm={handleRegenerate}
      />
    </div>
  );
}
