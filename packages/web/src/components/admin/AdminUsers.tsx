import React, { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '@festie/shared/services/api';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useAdminUserList } from '@festie/shared/hooks';
import {
  withReauth,
  setAdminRole,
  createResetLink,
  bulkForceLogout,
  type AdminUserRow,
} from '@festie/shared/services/admin';
import {
  maskEmail,
  roleChangeCopy,
  resetLinkCopy,
  resetLinkReadyMessage,
  bulkConfirmCopy,
  summarizeBulkResults,
  toggleSelection,
  SELECTION_LIMIT_MESSAGE,
} from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import PromptDialog from '../ui/PromptDialog';
import Button from '../ui/Button';
import { SearchX } from 'lucide-react';
import { useReauthPrompt } from '../../lib/useReauthPrompt';
import SelectionBar from './SelectionBar';
import AdminUserDetail from './AdminUserDetail';

interface ConfirmState {
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  run: () => Promise<void>;
}

/**
 * User management: list, search, admin toggle, deactivate
 */
export default function AdminUsers() {
  const { user: detailUserId } = useSearch({ from: '/admin' });
  if (detailUserId) return <AdminUserDetail userId={detailUserId} />;
  return <AdminUsersList />;
}

const cellBase =
  'flex items-center justify-between gap-3 px-2 py-1.5 before:text-sm before:font-medium before:text-text-muted before:content-[attr(data-label)] lg:table-cell lg:px-4 lg:py-3 lg:before:content-none';

function AdminUsersList() {
  const navigate = useNavigate();
  const selfId = useAuthStore((s) => s.user?.id);
  const { users, total, hasMore, loading, loadingMore, error, search, setSearch, loadMore, patchUser, removeUser } =
    useAdminUserList();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [linkToCopy, setLinkToCopy] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionNote, setSelectionNote] = useState<string | undefined>();
  // Emails stay masked until an admin expands one row.
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();

  const runConfirmed = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.run();
    } finally {
      setConfirmBusy(false);
      setConfirm(null);
    }
  };

  const askToggleAdmin = (user: AdminUserRow) => {
    const grant = !user.roles.includes('admin');
    const copy = roleChangeCopy(user.username, grant);
    setConfirm({
      title: copy.title,
      description: copy.message,
      confirmLabel: copy.confirmLabel,
      destructive: !grant,
      run: async () => {
        try {
          const roles = await withReauth(async () => (await setAdminRole(user.id, grant)).roles, askPassword);
          if (!roles) return;
          patchUser(user.id, { roles });
          toast(`User ${grant ? 'granted' : 'revoked'} admin access`, 'success');
        } catch (err: unknown) {
          toastError(err, "Couldn't update user. Try again.");
        }
      },
    });
  };

  const askDelete = (user: AdminUserRow) => {
    setConfirm({
      title: `Delete ${user.username}?`,
      description: 'This permanently removes their account, picks, and crew memberships. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
      run: async () => {
        try {
          const done = await withReauth(async () => {
            await api.delete<void>(`/admin/users/${user.id}`);
            return true;
          }, askPassword);
          if (!done) return;
          removeUser(user.id);
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(user.id);
            return next;
          });
          toast(`Deleted ${user.username}`, 'success');
        } catch (err: unknown) {
          toastError(err, "Couldn't delete user. Try again.");
        }
      },
    });
  };

  const askResetLink = (user: AdminUserRow) => {
    const copy = resetLinkCopy(user.username);
    setConfirm({
      title: copy.title,
      description: copy.message,
      confirmLabel: copy.confirmLabel,
      run: async () => {
        try {
          const { resetUrl, username, expiresAt } = await createResetLink(user.id);
          try {
            await navigator.clipboard.writeText(resetUrl);
            toast(`Reset link copied. ${resetLinkReadyMessage(username, expiresAt)}`, 'success');
          } catch {
            setLinkToCopy(resetUrl);
          }
        } catch (err: unknown) {
          toastError(err, "Couldn't create the reset link. Try again.");
        }
      },
    });
  };

  const askForceLogout = () => {
    const ids = [...selected];
    const copy = bulkConfirmCopy('force-logout', ids.length);
    setConfirm({
      title: copy.title,
      description: copy.message,
      confirmLabel: copy.confirmLabel,
      destructive: true,
      run: async () => {
        try {
          const done = await withReauth(() => bulkForceLogout(ids), askPassword);
          if (!done) return;
          toast(summarizeBulkResults('force-logout', done.results), 'success');
          setSelected(new Set());
          setSelectionNote(undefined);
        } catch (err: unknown) {
          toastError(err, "Couldn't force-logout those users. Try again.");
        }
      },
    });
  };

  const onToggleSelect = (id: string) => {
    const { next, limited } = toggleSelection(selected, id);
    setSelected(next);
    setSelectionNote(limited ? SELECTION_LIMIT_MESSAGE : undefined);
  };

  if (loading && users.length === 0 && !search) {
    return <div className="text-center py-12 text-text-muted">Loading users…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="type-heading text-text-primary">Users ({total})</h2>
      </div>

      <input
        type="text"
        placeholder="Search by username or email…"
        aria-label="Search users by username or email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
      />

      {error && users.length === 0 ? (
        <div role="alert" className="text-center py-8 text-accent-coral">
          {error}
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
          title="No users found"
          description={`No users match "${search}". Search covers every user.`}
        />
      ) : (
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
          {/* Table on lg+, stacked label/value cards below 1024px (§6 admin). */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm block lg:table">
              <caption className="sr-only">User management</caption>
              <thead className="hidden lg:table-header-group">
                <tr className="border-b border-glass-border bg-bg-primary/20">
                  <th className="px-4 py-3 text-left text-text-muted font-medium">
                    <span className="sr-only">Select</span>
                  </th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Username</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Email</th>
                  <th className="px-4 py-3 text-center text-text-muted font-medium">Verified</th>
                  <th className="px-4 py-3 text-center text-text-muted font-medium">Admin</th>
                  <th className="px-4 py-3 text-left text-text-muted font-medium">Joined</th>
                  <th className="px-4 py-3 text-right text-text-muted font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="block lg:table-row-group lg:divide-y lg:divide-glass-border">
                {users.map((user) => {
                  const isSelf = user.id === selfId;
                  const isAdminUser = user.roles.includes('admin');
                  return (
                    <tr
                      key={user.id}
                      className="block lg:table-row mb-3 rounded-lg border border-glass-border bg-bg-card/40 p-2 last:mb-0 transition-colors hover:bg-bg-primary/20 lg:mb-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0"
                    >
                      <td data-label="Select" className={cellBase}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${user.username}`}
                          checked={selected.has(user.id)}
                          disabled={isSelf}
                          onChange={() => onToggleSelect(user.id)}
                          className="h-5 w-5"
                        />
                      </td>
                      <td data-label="Username" className={`${cellBase} font-medium text-text-primary`}>
                        <span className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => navigate({ to: '/admin', search: { tab: 'users', user: user.id } })}
                            className="min-h-11 text-left text-text-primary hover:text-accent-aqua focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
                          >
                            {user.username}
                          </button>
                          {isSelf && (
                            <span className="rounded-full bg-accent-aqua/20 px-2 py-0.5 text-xs text-accent-aqua">
                              You
                            </span>
                          )}
                        </span>
                      </td>
                      <td data-label="Email" className={`${cellBase} text-xs text-text-secondary lg:text-xs`}>
                        <span className="flex items-center gap-2">
                          <span data-testid={`user-email-${user.id}`}>
                            {user.email !== null && revealedId === user.id ? user.email : maskEmail(user.email)}
                          </span>
                          {user.email !== null && (
                            <button
                              type="button"
                              onClick={() => setRevealedId(revealedId === user.id ? null : user.id)}
                              aria-pressed={revealedId === user.id}
                              aria-label={`${revealedId === user.id ? 'Hide' : 'Show'} full email for ${user.username}`}
                              className="px-2 min-h-11 rounded-md text-xs text-accent-aqua hover:bg-accent-aqua/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
                            >
                              {revealedId === user.id ? 'Hide' : 'Show'}
                            </button>
                          )}
                        </span>
                      </td>
                      <td data-label="Verified" className={`${cellBase} lg:text-center`}>
                        {user.emailVerified ? (
                          <span className="text-xs text-accent-green">Verified</span>
                        ) : (
                          <span className="text-xs text-text-muted">Not verified</span>
                        )}
                      </td>
                      <td data-label="Admin" className={`${cellBase} lg:text-center`}>
                        {isAdminUser ? (
                          <span className="text-xs font-bold text-accent-coral">ADMIN</span>
                        ) : (
                          <span className="text-xs text-text-muted lg:hidden">—</span>
                        )}
                      </td>
                      <td data-label="Joined" className={`${cellBase} text-xs text-text-muted`}>
                        {new Date(user.createdAt).toISOString().slice(0, 10)}
                      </td>
                      <td data-label="Actions" className={`${cellBase} lg:text-right`}>
                        <span className="flex flex-wrap gap-2 lg:justify-end">
                          <button
                            onClick={() => askResetLink(user)}
                            className="text-xs px-2 py-1 min-h-11 rounded-md bg-bg-primary/40 text-text-secondary hover:bg-bg-primary/60 transition-colors"
                          >
                            Copy reset link
                          </button>
                          {!isSelf && (
                            <>
                              <button
                                onClick={() => askToggleAdmin(user)}
                                className="text-xs px-2 py-1 min-h-11 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors"
                              >
                                {isAdminUser ? 'Revoke' : 'Grant'} Admin
                              </button>
                              <button
                                onClick={() => askDelete(user)}
                                className="text-xs px-2 py-1 min-h-11 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors"
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {users.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-text-muted">
            Showing {users.length} of {total}
          </p>
          {hasMore && (
            <Button type="button" variant="secondary" isLoading={loadingMore} onClick={() => loadMore()} className="min-h-11">
              Load more
            </Button>
          )}
        </div>
      )}

      <SelectionBar
        count={selected.size}
        actionLabel="Force-logout"
        onAction={askForceLogout}
        onClear={() => {
          setSelected(new Set());
          setSelectionNote(undefined);
        }}
        note={selectionNote}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm?.title || ''}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        destructive={confirm?.destructive}
        busy={confirmBusy}
        onConfirm={runConfirmed}
      />
      <PromptDialog
        open={linkToCopy !== null}
        onOpenChange={(o) => !o && setLinkToCopy(null)}
        title="Copy this link"
        defaultValue={linkToCopy ?? ''}
        confirmLabel="Done"
        onConfirm={() => setLinkToCopy(null)}
        maxLength={500}
      />
      {reauthDialog}
    </div>
  );
}
