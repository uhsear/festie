import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  useAuthStore,
  ACCOUNT_DELETION_EXPLAINER,
  accountDeletionNotice,
} from '@festie/shared/stores/authStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { crewCopy, ownedCrewsForDeletion } from '@festie/shared/utils/crewManage';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { withReauth } from '@festie/shared/services/admin';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { useToast } from '../../lib/toastContext';
import { useIdentities } from '../../lib/useIdentities';
import { useReauthPrompt } from '../../lib/useReauthPrompt';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function DangerZone() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const userId = useAuthStore((s) => s.user?.id);
  const crews = useCrewStore((s) => s.crews);
  const loadCrews = useCrewStore((s) => s.loadCrews);
  const [newOwners, setNewOwners] = useState<Record<string, string>>({});
  const offlineMode = useUIStore((s) => s.offlineMode);
  const { data: identities } = useIdentities();
  const providerOnly = identities?.hasPassword === false;
  const { ask, reauthDialog } = useReauthPrompt({
    hasPassword: !providerOnly,
    linked: identities?.identities.map((i) => i.provider),
  });

  const [deletePassword, setDeletePassword] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (showDeleteConfirm && crews.length === 0) loadCrews().catch(() => {});
    // Load once per open; the crew list is the store's, not this form's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDeleteConfirm]);

  const { handover, soloCount } = useMemo(
    () => (userId ? ownedCrewsForDeletion(crews, userId) : { handover: [], soloCount: 0 }),
    [crews, userId],
  );

  useEffect(() => {
    if (showDeleteConfirm) deleteFormRef.current?.querySelector('input')?.focus();
  }, [showDeleteConfirm]);

  const handleDelete = async () => {
    if (!providerOnly && !deletePassword) return;

    setDeleting(true);
    try {
      const choices = handover.map((h) => ({
        crewId: h.crew.id,
        newOwnerId: newOwners[h.crew.id] ?? h.defaultOwnerId,
      }));
      // A provider-only account sends no password; the server needs a recent provider re-auth instead.
      const outcome = providerOnly
        ? await withReauth(() => deleteAccount(undefined as unknown as string, choices), ask)
        : await deleteAccount(deletePassword, choices);
      if (!outcome) return;
      toast(accountDeletionNotice(outcome.deletionDate), 'info');
      navigate({ to: '/login' });
    } catch (err) {
      setDeleteError(mapErrorToUserMessage(err, ACCOUNT_COPY.deleteFailed));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      {/* Delete account section */}
      <section
        className={cn(
          'p-4 rounded-lg border space-y-3',
          'bg-accent-coral/5 border-accent-coral/30',
        )}
      >
        <h3 className="text-sm font-semibold text-accent-coral flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          Delete Account
        </h3>

        <p className="text-sm text-text-muted">
          {ACCOUNT_DELETION_EXPLAINER}
        </p>

        {!showDeleteConfirm ? (
          <Button
            variant="danger"
            fullWidth
            onClick={() => setShowDeleteConfirm(true)}
            className="min-h-[44px]"
          >
            Delete My Account
          </Button>
        ) : (
          <form
            ref={deleteFormRef}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if ((providerOnly || deletePassword) && !deleting) handleDelete();
            }}
          >
            {handover.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-text-primary">{crewCopy.deleteOwnedTitle}</h4>
                <p className="text-sm text-text-muted">{crewCopy.deleteOwnedBody}</p>
                {handover.map((h) => (
                  <label key={h.crew.id} className="block text-sm text-text-secondary">
                    {crewCopy.newOwnerFor(h.crew.name)}
                    <select
                      className="mt-1 block w-full min-h-11 rounded-lg bg-bg-card border border-border px-2 text-text-primary"
                      value={newOwners[h.crew.id] ?? h.defaultOwnerId}
                      onChange={(e) => setNewOwners((prev) => ({ ...prev, [h.crew.id]: e.target.value }))}
                    >
                      {h.candidates.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name || m.username}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
            {soloCount > 0 && <p className="text-sm text-text-muted">{crewCopy.deleteSolo(soloCount)}</p>}
            {!providerOnly && (
            <Input
              label="Enter your password to confirm"
              type="password"
              isPassword
              value={deletePassword}
              onChange={(e) => {
                setDeletePassword(e.target.value);
                setDeleteError(null);
              }}
              placeholder="Password"
              autoComplete="current-password"
              error={deleteError ?? undefined}
            />
            )}
            {providerOnly && deleteError && (
              <p role="alert" className="text-sm text-accent-coral">{deleteError}</p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeletePassword('');
                  setDeleteError(null);
                }}
                className="flex-1 min-h-[44px]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                isLoading={deleting}
                disabled={offlineMode || (!providerOnly && !deletePassword)}
                className="flex-1 min-h-[44px]"
              >
                Confirm Delete
              </Button>
            </div>
          </form>
        )}
      </section>
      {reauthDialog}
    </>
  );
}
