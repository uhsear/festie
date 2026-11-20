import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, SearchX } from 'lucide-react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  addOrganizationMember,
  removeOrganizationMember,
  removePendingMember,
  setOrganizationStatus,
  setOrganizationVerified,
} from '@festie/shared/services/adminOrganizations';
import { organizerFestivalStatus, type OrgRole } from '@festie/shared/services/organizer';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import { INPUT_CLASS } from './adminStyles';
import { adminKeys, useOrganization } from './adminQueries';
import { useAdminSearch } from './useAdminSearch';

interface Props {
  organizationId: string;
  onBack: () => void;
  /** Runs a member change that needs a recent password, asking for it when the server wants it. */
  reauth: <T>(run: () => Promise<T>) => Promise<T | null>;
}

type Pending = { title: string; description: string; label: string; destructive?: boolean; run: () => Promise<unknown> } | null;

const ROLES: ReadonlyArray<{ value: OrgRole; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

const smallButton =
  'inline-flex items-center justify-center min-h-11 px-3 rounded-lg border border-glass-border text-sm text-text-primary hover:bg-bg-card transition-colors disabled:opacity-50';

/** One organization: status, verification, members by email, pending members and its festivals. */
export default function AdminOrganizationDetail({ organizationId, onBack, reauth }: Props) {
  const queryClient = useQueryClient();
  const { toast, toastError } = useToast();
  const [, setAdminSearch] = useAdminSearch();
  const org = useOrganization(organizationId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('owner');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.organization(organizationId) });
    await queryClient.invalidateQueries({ queryKey: adminKeys.organizations });
  };

  const act = async (run: () => Promise<unknown>, done: string, fail: string) => {
    setBusy(true);
    try {
      const result = await run();
      if (result === null) return;
      toast(done, 'success');
      await refresh();
    } catch (err) {
      toastError(err, fail);
    } finally {
      setBusy(false);
    }
  };

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    await act(
      async () => {
        const added = await reauth(() => addOrganizationMember(organizationId, { email: address, role }));
        if (added !== null) setEmail('');
        return added;
      },
      'Member added. A person without an account joins when they sign in with this email and confirm it.',
      "Couldn't add the member. Try again.",
    );
  };

  const confirm = async () => {
    if (!pending) return;
    const { run } = pending;
    setPending(null);
    await act(run, 'Done.', "Couldn't finish that. Try again.");
  };

  const back = (
    <button type="button" onClick={onBack} className="inline-flex items-center gap-2 min-h-11 text-sm text-text-secondary hover:text-text-primary transition-colors">
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to organizations
    </button>
  );

  if (org.isPending) {
    return (
      <div className="space-y-4">
        {back}
        <div role="status" className="py-12 text-center text-text-muted">
          Loading organization…
        </div>
      </div>
    );
  }
  if (org.isError) {
    return (
      <div className="space-y-4">
        {back}
        <EmptyState
          icon={<SearchX className="h-9 w-9" aria-hidden="true" />}
          title="Couldn't load this organization"
          description={mapErrorToUserMessage(org.error, 'Check your connection, then try again.')}
          cta={{ label: 'Retry', onClick: () => void org.refetch() }}
        />
      </div>
    );
  }

  const data = org.data;
  const verified = !!data.verifiedAt;
  const statusText = data.status === 'pending' ? 'Waiting for activation' : data.status === 'active' ? 'Active' : 'Suspended';

  const setStatus = (status: 'active' | 'suspended') => () => setOrganizationStatus(organizationId, status);

  return (
    <div className="space-y-6">
      {back}
      <div className="space-y-2">
        <h2 className="type-heading text-text-primary">{data.name}</h2>
        <p className="text-sm text-text-secondary">
          {data.kind}. Status: {statusText}. {verified ? 'Verified: it publishes without review.' : 'Not verified: every first publish needs your review.'}
        </p>
        {data.website && <p className="break-all text-xs text-text-muted">{data.website}</p>}
        <div className="flex flex-wrap gap-2">
          {data.status !== 'active' && (
            <button type="button" disabled={busy} className={smallButton} onClick={() => void act(setStatus('active'), 'Organization is active.', "Couldn't activate it. Try again.")}>
              {data.status === 'pending' ? 'Activate' : 'Activate again'}
            </button>
          )}
          {data.status !== 'suspended' && (
            <button
              type="button"
              disabled={busy}
              className={smallButton}
              onClick={() =>
                setPending({
                  title: `Suspend ${data.name}?`,
                  description: 'Its members cannot save changes. Its live festivals stay visible to attendees.',
                  label: 'Suspend',
                  destructive: true,
                  run: setStatus('suspended'),
                })
              }
            >
              Suspend
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            className={smallButton}
            onClick={() =>
              setPending({
                title: verified ? `Remove verification from ${data.name}?` : `Verify ${data.name}?`,
                description: verified
                  ? 'Its next festivals need your review before they go live.'
                  : 'A verified organization publishes its festivals without your review.',
                label: verified ? 'Remove verification' : 'Verify',
                run: () => setOrganizationVerified(organizationId, !verified),
              })
            }
          >
            {verified ? 'Remove verification' : 'Verify'}
          </button>
        </div>
      </div>

      <section aria-label="Members" className="space-y-3">
        <h3 className="type-label text-text-primary">Members ({data.members.length})</h3>
        {data.members.length === 0 ? (
          <p className="text-sm text-text-muted">No members yet. Add the owner by email below.</p>
        ) : (
          <ul className="list-none space-y-2 p-0">
            {data.members.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-glass-border p-3">
                <div className="min-w-0">
                  <p className="break-all text-sm text-text-primary">{m.email ?? m.username}</p>
                  <p className="text-xs text-text-muted">
                    {m.role}
                    {m.active ? '' : '. Account is not active.'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  className={smallButton}
                  aria-label={`Remove ${m.email ?? m.username}`}
                  onClick={() =>
                    setPending({
                      title: `Remove ${m.email ?? m.username}?`,
                      description: `They lose access to ${data.name}. You can add them again later.`,
                      label: 'Remove',
                      destructive: true,
                      run: () => reauth(() => removeOrganizationMember(organizationId, m.userId)),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {data.pending.length > 0 && (
          <>
            <h4 className="text-sm font-semibold text-text-primary">Waiting to join ({data.pending.length})</h4>
            <ul className="list-none space-y-2 p-0">
              {data.pending.map((p) => (
                <li key={p.email} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-glass-border p-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm text-text-primary">{p.email}</p>
                    <p className="text-xs text-text-muted">{p.role}. Joins when they sign in with this email and confirm it.</p>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className={smallButton}
                    aria-label={`Remove ${p.email} from the waiting list`}
                    onClick={() =>
                      setPending({
                        title: `Remove ${p.email}?`,
                        description: 'They will not join this organization unless you add them again.',
                        label: 'Remove',
                        destructive: true,
                        run: () => reauth(() => removePendingMember(organizationId, p.email)),
                      })
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <form onSubmit={addMember} aria-label="Add a member" className="grid grid-cols-1 gap-3 rounded-lg border border-glass-border bg-bg-card/60 p-4 md:grid-cols-[1fr_auto_auto] md:items-end">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Member email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="name@venue.example" className={INPUT_CLASS} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className={INPUT_CLASS}>
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !email.trim()} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent-aqua px-4 text-sm font-medium text-bg-primary disabled:opacity-50">
            Add member
          </button>
        </form>
      </section>

      <section aria-label="Festivals" className="space-y-3">
        <h3 className="type-label text-text-primary">Festivals ({data.festivals.filter((f) => !f.deleted).length})</h3>
        <ul className="list-none space-y-2 p-0">
          {data.festivals
            .filter((f) => !f.deleted)
            .map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-glass-border p-3">
                <div className="min-w-0">
                  <p className="text-sm text-text-primary">{f.name}</p>
                  <p className="text-xs text-text-muted">{organizerFestivalStatus(f).chip}</p>
                </div>
                <button type="button" className={smallButton} aria-label={`Open ${f.name}`} onClick={() => setAdminSearch({ tab: 'festivals', festival: f.id })}>
                  Open
                </button>
              </li>
            ))}
        </ul>
      </section>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.title ?? ''}
        description={pending?.description}
        confirmLabel={pending?.label ?? 'Confirm'}
        destructive={pending?.destructive}
        busy={busy}
        onConfirm={confirm}
      />
    </div>
  );
}
