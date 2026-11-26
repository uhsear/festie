import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { withReauth } from '@festie/shared/services/admin';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  addManageMember,
  changeManageMemberRole,
  describeUpload,
  removeManageInvitation,
  removeManageMember,
  type ManageOrganization,
  type OrgRole,
} from '@festie/shared/services/organizer';
import { useReauthPrompt } from '../../hooks/useReauthPrompt';
import { useToast } from '../../lib/toastContext';
import ConfirmDialog from '../ui/ConfirmDialog';
import EmptyState from '../ui/EmptyState';
import { INPUT_CLASS } from '../admin/adminStyles';
import { adminKeys, useManageOrganization } from '../admin/adminQueries';
import ManageOrgProfile from './ManageOrgProfile';

interface Props {
  organization: ManageOrganization;
}

type Pending = { title: string; description: string; label: string; run: () => Promise<unknown> } | null;

// An owner adds and changes editors and viewers only. Owners are Festie's to set (plan-v3 3.3).
const ROLES: ReadonlyArray<{ value: OrgRole; label: string }> = [
  { value: 'editor', label: 'Editor' },
  { value: 'viewer', label: 'Viewer' },
];

const ROLE_TEXT: Record<OrgRole, string> = {
  owner: 'Owner. Can do everything, including the team.',
  editor: 'Editor. Can change festivals.',
  viewer: 'Viewer. Can look but not change.',
};

const smallButton =
  'inline-flex items-center justify-center min-h-11 px-3 rounded-xl border border-glass-border text-sm text-text-primary hover:bg-bg-card transition-colors disabled:opacity-50';

/** The team screen of /manage: profile, members, invitations and storage of one organization (plan-v3 5.7). */
export default function ManageTeam({ organization }: Props) {
  const queryClient = useQueryClient();
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();
  const detail = useManageOrganization(organization.id);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('editor');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const reauth = <T,>(run: () => Promise<T>) => withReauth(run, askPassword, { retryWrongPassword: true });
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.manageOrganization(organization.id) });

  const act = async <T,>(run: () => Promise<T>, done: string | ((result: T) => string), fail: string, warn?: (result: T) => boolean) => {
    setBusy(true);
    try {
      const result = await run();
      if (result === null) return;
      toast(typeof done === 'function' ? done(result) : done, warn?.(result) ? 'warning' : 'success');
      await refresh();
    } catch (err) {
      toastError(err, fail);
    } finally {
      setBusy(false);
    }
  };

  if (detail.isPending) return <div className="py-12 text-center text-text-muted">Loading team…</div>;
  if (detail.isError) {
    return (
      <EmptyState
        icon={<SearchX className="h-9 w-9" aria-hidden="true" />}
        title="Couldn't load your team"
        description={mapErrorToUserMessage(detail.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void detail.refetch() }}
      />
    );
  }

  const data = detail.data;
  const isOwner = data.role === 'owner';
  const suspended = data.status === 'suspended';
  const canManage = isOwner && data.status === 'active';
  const owners = data.members.filter((m) => m.role === 'owner' && m.active).flatMap((m) => (m.name ? [m.name] : []));

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    await act(
      async () => {
        const added = await reauth(() => addManageMember(organization.id, { email: address, role }));
        if (added !== null) setEmail('');
        return added;
      },
      (added) =>
        added?.emailed === false
          ? 'Added, but the email could not be sent. Tell them to sign in with this address.'
          : 'Added. They get one email, and join when they sign in with this address and confirm it.',
      "Couldn't add them. Try again.",
      (added) => added?.emailed === false,
    );
  };

  const confirm = async () => {
    if (!pending) return;
    const { run } = pending;
    setPending(null);
    await act(run, 'Done.', "Couldn't finish that. Try again.");
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="type-heading text-text-primary">{data.displayName || data.name}</h2>
        <p className="text-sm text-text-secondary">
          {data.role === 'owner' ? 'You are an owner.' : `You are ${data.role === 'editor' ? 'an editor' : 'a viewer'}.`}{' '}
          {!isOwner && `Only an owner of ${data.name} can change the team${owners.length > 0 ? `: ${owners.join(', ')}` : ''}.`}
        </p>
        {suspended && (
          <p role="alert" className="text-sm text-accent-amber">
            Your organization&apos;s access is paused. Your live festivals stay visible to attendees.{' '}
            <a href="mailto:support@festie.us" className="underline">
              Contact Festie
            </a>
          </p>
        )}
      </div>

      <section aria-label="Organization" className="space-y-3">
        <h3 className="type-label text-text-primary">Organization</h3>
        <ManageOrgProfile key={`${data.name}|${data.displayName}|${data.contactEmail}|${data.website}`} organization={data} canEdit={isOwner && !suspended} />
        <p className="text-xs text-text-muted">{describeUpload(data.upload)}</p>
      </section>

      <section aria-label="Members" className="space-y-3">
        <h3 className="type-label text-text-primary">Members ({data.members.length})</h3>
        <ul className="list-none space-y-2 p-0">
          {data.members.map((m) => {
            const label = m.name ?? m.email ?? 'A teammate';
            const editable = canManage && m.role !== 'owner';
            return (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-glass-border p-3">
                <div className="min-w-0">
                  <p className="break-all text-sm text-text-primary">{label}</p>
                  {m.name && m.email && <p className="break-all text-xs text-text-muted">{m.email}</p>}
                  <p className="text-xs text-text-muted">
                    {ROLE_TEXT[m.role]} Added by {m.addedBy}.{m.active ? '' : ' Not active yet.'}
                  </p>
                </div>
                {editable && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Role of ${label}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value as OrgRole;
                        void act(() => reauth(() => changeManageMemberRole(organization.id, m.userId, next)), 'Role changed.', "Couldn't change the role. Try again.");
                      }}
                      className={`${INPUT_CLASS} min-h-11 w-auto`}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy}
                      className={smallButton}
                      aria-label={`Remove ${label}`}
                      onClick={() =>
                        setPending({
                          title: `Remove ${label}?`,
                          description: `They lose access to ${data.name} at once. You can add them again later.`,
                          label: 'Remove',
                          run: () => reauth(() => removeManageMember(organization.id, m.userId)),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {isOwner && data.pending.length > 0 && (
          <>
            <h4 className="text-sm font-semibold text-text-primary">Waiting to join ({data.pending.filter((p) => !p.expired).length})</h4>
            <ul className="list-none space-y-2 p-0">
              {data.pending.map((p) => (
                <li key={p.email} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-glass-border p-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm text-text-primary">{p.email}</p>
                    <p className="text-xs text-text-muted">
                      {p.role === 'viewer' ? 'Viewer' : p.role === 'editor' ? 'Editor' : 'Owner'}. Added by {p.addedBy}.{' '}
                      {p.expired
                        ? 'Expired: they can no longer join with this invitation. Add them again to send a new one.'
                        : 'Joins when they sign in with this email and confirm it.'}
                    </p>
                  </div>
                  {canManage && p.role !== 'owner' && (
                    <button
                      type="button"
                      disabled={busy}
                      className={smallButton}
                      aria-label={`Remove ${p.email} from the waiting list`}
                      onClick={() =>
                        setPending({
                          title: `Remove ${p.email}?`,
                          description: 'They will not join unless you add them again.',
                          label: 'Remove',
                          run: () => reauth(() => removeManageInvitation(organization.id, p.email)),
                        })
                      }
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}

        {canManage && (
          <form onSubmit={addMember} aria-label="Add a member" className="grid grid-cols-1 gap-3 rounded-xl border border-glass-border bg-bg-card/60 p-4 md:grid-cols-[1fr_auto_auto] md:items-end">
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} placeholder="name@venue.example" className={`${INPUT_CLASS} min-h-11`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">
              Role
              <select value={role} onChange={(e) => setRole(e.target.value as OrgRole)} className={`${INPUT_CLASS} min-h-11`}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy || !email.trim()} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent-aqua px-4 text-sm font-medium text-bg-primary disabled:opacity-50">
              Add member
            </button>
          </form>
        )}
        {isOwner && data.status === 'pending' && (
          <p className="text-sm text-text-muted">Adding people unlocks when Festie approves your organization.</p>
        )}
      </section>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.title ?? ''}
        description={pending?.description}
        confirmLabel={pending?.label ?? 'Confirm'}
        destructive
        busy={busy}
        onConfirm={confirm}
      />
      {reauthDialog}
    </div>
  );
}
