import React, { useState } from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { useSignedInDevices, deviceTitle, deviceSubtitle, type SignedInDevice } from '@festie/shared/hooks';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';
import Skeleton from '../ui/Skeleton';

export default function DevicesSection() {
  const { toast } = useToast();
  const { devices, loading, error, reload, signOut, signOutOthers } = useSignedInDevices();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSignOut = async (d: SignedInDevice) => {
    try {
      await signOut(d.id);
      toast(ACCOUNT_COPY.signedOutDevice(deviceTitle(d)), 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, ACCOUNT_COPY.signOutFailed), 'error');
    }
  };

  const handleSignOutOthers = async () => {
    setBusy(true);
    try {
      await signOutOthers();
      setConfirmOpen(false);
      toast(ACCOUNT_COPY.signedOutOthers, 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, ACCOUNT_COPY.signOutFailed), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <MonitorSmartphone className="w-4 h-4" aria-hidden="true" />
        {ACCOUNT_COPY.devicesTitle}
      </h3>

      {loading && devices.length === 0 ? (
        <div className="space-y-2">
          <Skeleton />
          <Skeleton />
        </div>
      ) : error ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-danger)]">{error}</p>
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary truncate">{deviceTitle(d)}</p>
                  <p className="text-xs text-text-muted">{deviceSubtitle(d)}</p>
                </div>
                {!d.current && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-[44px] shrink-0"
                    aria-label={`${ACCOUNT_COPY.signOutDevice} ${deviceTitle(d)}`}
                    onClick={() => void handleSignOut(d)}
                  >
                    {ACCOUNT_COPY.signOutDevice}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {devices.length === 1 && <p className="text-sm text-text-muted">{ACCOUNT_COPY.onlyThisDevice}</p>}
          {devices.length > 1 && (
            <Button
              variant="ghost"
              fullWidth
              className="min-h-[44px] text-accent-coral border-accent-coral/60 hover:border-accent-coral"
              onClick={() => setConfirmOpen(true)}
            >
              {ACCOUNT_COPY.signOutOthers}
            </Button>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={ACCOUNT_COPY.signOutOthersTitle}
        description={ACCOUNT_COPY.signOutOthersBody}
        confirmLabel={ACCOUNT_COPY.signOutOthersConfirm}
        destructive
        busy={busy}
        onConfirm={handleSignOutOthers}
      />
    </section>
  );
}
