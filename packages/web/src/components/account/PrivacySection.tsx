import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { PRIVACY_COPY } from '@festie/shared/constants';
import { buildPrivacySummary } from '@festie/shared/utils/privacySummary';
import {
  fetchSharingStatus,
  stopAllSharing,
  type SharingStatus,
} from '@festie/shared/services/sharing';
import { useToast } from '../../lib/toastContext';
import Button from '../ui/Button';
import ConfirmDialog from '../ui/ConfirmDialog';

type StatusLocations = NonNullable<SharingStatus['statusLocations']>;

const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "Who can see what": one place that lists every way the user's data is shared, with a stop-all button. */
export default function PrivacySection() {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const shareIntent = useLiveLocationStore((s) => s.shareIntent);
  const crews = useCrewStore((s) => s.crews);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewStatuses = useCrewStore((s) => s.crewStatuses);
  const offlineMode = useUIStore((s) => s.offlineMode);
  const [statusLocations, setStatusLocations] = useState<StatusLocations | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopping, setStopping] = useState(false);

  const loadStatus = useCallback(() => {
    fetchSharingStatus()
      .then((s) => setStatusLocations(s.statusLocations ?? null))
      .catch((err) => {
        console.error('Could not load sharing status', err);
        setStatusLocations(null);
      });
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (!user) return null;

  const myStatus = crewStatuses.find((s) => s.user_id === user.id) ?? null;
  const { rows, canStop } = buildPrivacySummary({
    user,
    shareIntent,
    statusLocations,
    myStatus,
    crewNameById: (id) => crews.find((c) => c.id === id)?.name ?? null,
    activeCrewName: activeCrew?.name ?? null,
    formatClock,
  });

  const handleStop = async () => {
    setStopping(true);
    try {
      await stopAllSharing();
      setStatusLocations([]);
      toast(PRIVACY_COPY.done, 'success');
    } catch {
      toast(PRIVACY_COPY.error, 'error');
      loadStatus();
    } finally {
      setStopping(false);
      setConfirmOpen(false);
    }
  };

  return (
    <section className="p-4 rounded-lg bg-bg-card border border-border space-y-3">
      <h3 className="text-sm font-semibold text-text-secondary flex items-center gap-2">
        <ShieldCheck className="w-4 h-4" aria-hidden="true" />
        {PRIVACY_COPY.title}
      </h3>

      <dl className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-3">
            <dt className="text-sm font-medium text-text-primary flex items-start gap-2">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${row.active ? 'bg-accent-aqua' : 'bg-transparent'}`}
              />
              {row.label}
            </dt>
            <dd className="text-sm text-text-secondary">{row.value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-text-muted">{PRIVACY_COPY.noFriendGraph}</p>
      <p className="text-xs text-text-muted">{PRIVACY_COPY.freeOffline}</p>

      <Button
        variant="outline"
        fullWidth
        disabled={!canStop || offlineMode || stopping}
        onClick={() => setConfirmOpen(true)}
        className="min-h-[44px] text-text-danger"
      >
        {PRIVACY_COPY.stopButton}
      </Button>
      {!canStop && <p className="text-xs text-text-muted">{PRIVACY_COPY.stopHintNone}</p>}

      <a
        href="/privacy.html"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block text-sm text-accent-aqua underline"
      >
        {PRIVACY_COPY.policyLink}
      </a>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={PRIVACY_COPY.confirmTitle}
        description={PRIVACY_COPY.confirmBody}
        confirmLabel={PRIVACY_COPY.confirmButton}
        cancelLabel={PRIVACY_COPY.cancel}
        destructive
        busy={stopping}
        onConfirm={handleStop}
      />
    </section>
  );
}
