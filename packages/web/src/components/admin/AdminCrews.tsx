import React, { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import {
  addCrewMember,
  fetchAdminCrews,
  removeCrewMember,
  type AdminCrewRow,
} from '@festie/shared/services/admin';
import { filterAdminCrews, removeMemberCopy } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import ConfirmDialog from '../ui/ConfirmDialog';
import UserPickerDialog from './UserPickerDialog';
import { SearchX } from 'lucide-react';

interface CrewMember {
  userId: string;
  username?: string;
  role?: string;
  // Raw getMembers row fields (routes/admin-bulk.ts returns them unserialized).
  avatarKey?: string | null;
  avatarVersion?: string | null;
  joinedAt?: string;
}

function memberAvatarUrl(m: CrewMember): string | null {
  if (!m.avatarKey || !m.avatarVersion) return null;
  return `/uploads/avatars/${m.avatarKey}.webp?v=${encodeURIComponent(m.avatarVersion)}`;
}

/**
 * Crew management: list, search, delete, view members
 */
export default function AdminCrews() {
  const [crews, setCrews] = useState<AdminCrewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersByCrew, setMembersByCrew] = useState<Record<string, CrewMember[]>>({});
  const [membersLoading, setMembersLoading] = useState<Record<string, boolean>>({});
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string; description: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pickerCrewId, setPickerCrewId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ crewId: string; member: CrewMember } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const { toast, toastError } = useToast();

  useEffect(() => {
    loadCrews();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- load once on mount

  const loadCrews = async () => {
    try {
      setLoading(true);
      const result = await fetchAdminCrews();
      setCrews(Array.isArray(result) ? result : []);
    } catch (err: unknown) {
      toastError(err, "Couldn't load crews. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const loadCrewMembers = async (crewId: string, force = false) => {
    // Already cached — re-expand is instant.
    if (!force && membersByCrew[crewId]) return;
    setMembersLoading((prev) => ({ ...prev, [crewId]: true }));
    try {
      const result = await api.get<CrewMember[]>(`/admin/crews/${crewId}/members`);
      setMembersByCrew((prev) => ({ ...prev, [crewId]: Array.isArray(result) ? result : [] }));
    } catch (err: unknown) {
      toastError(err, "Couldn't load members. Try again.");
    } finally {
      setMembersLoading((prev) => ({ ...prev, [crewId]: false }));
    }
  };

  const handleToggleExpand = (crewId: string) => {
    if (expandedId === crewId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(crewId);
    // Fire-and-forget; state drives UI.
    void loadCrewMembers(crewId);
  };

  const handleDelete = (crewId: string) => {
    const target = crews.find((c) => c.id === crewId);
    const name = target?.name || 'this crew';
    const links = `${target?.memberCount ?? ''} member link${target?.memberCount === 1 ? '' : 's'}`.trim();
    setConfirmDelete({
      id: crewId,
      title: `Delete ${name}?`,
      description: `This removes the crew and all ${links}. Members will lose access to shared picks.`,
    });
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    const name = crews.find((c) => c.id === id)?.name || 'this crew';
    setDeleteBusy(true);
    try {
      await api.delete<void>(`/admin/crews/${id}`);
      setCrews(crews.filter((c) => c.id !== id));
      toast(`Deleted ${name}`, 'success');
      setConfirmDelete(null);
    } catch (err: unknown) {
      toastError(err, "Couldn't delete crew. Try again.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const adjustMemberCount = (crewId: string, delta: number) =>
    setCrews((prev) => prev.map((c) => (c.id === crewId ? { ...c, memberCount: c.memberCount + delta } : c)));

  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast('Invite code copied.', 'success');
    } catch (err: unknown) {
      toastError(err, "Couldn't copy the invite code.");
    }
  };

  const pickerCrew = crews.find((c) => c.id === pickerCrewId) ?? null;

  const handlePick = async (user: { id: string; username: string }) => {
    if (!pickerCrew) return;
    await addCrewMember(pickerCrew.id, user.id);
    toast(`Added @${user.username} to ${pickerCrew.name}.`, 'success');
    adjustMemberCount(pickerCrew.id, 1);
    setPickerCrewId(null);
    void loadCrewMembers(pickerCrew.id, true);
  };

  const doRemove = async () => {
    if (!removeTarget) return;
    const { crewId, member } = removeTarget;
    const crewName = crews.find((c) => c.id === crewId)?.name || 'this crew';
    setRemoveBusy(true);
    try {
      await removeCrewMember(crewId, member.userId);
      setMembersByCrew((prev) => ({ ...prev, [crewId]: (prev[crewId] ?? []).filter((m) => m.userId !== member.userId) }));
      adjustMemberCount(crewId, -1);
      toast(`Removed @${member.username || member.userId} from ${crewName}.`, 'success');
      setRemoveTarget(null);
    } catch (err: unknown) {
      toastError(err, "Couldn't remove that member. Try again.");
    } finally {
      setRemoveBusy(false);
    }
  };

  const filteredCrews = filterAdminCrews(crews, searchQuery);
  const removeCopy = removeTarget
    ? removeMemberCopy(
        removeTarget.member.username || removeTarget.member.userId,
        crews.find((c) => c.id === removeTarget.crewId)?.name || 'this crew',
      )
    : null;

  if (loading) {
    return <div className="text-center py-12 text-text-muted">Loading crews…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="type-heading text-text-primary">Crews ({filteredCrews.length})</h2>
      </div>

      <input
        type="text"
        aria-label="Search crews"
        placeholder="Search by crew, creator, festival or invite code…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="w-full px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
      />

      {filteredCrews.length === 0 ? (
        <EmptyState
          icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
          title="No crews found"
          description="Try adjusting your search query."
        />
      ) : (
        <div className="space-y-3">
          {filteredCrews.map((crew) => {
            const isExpanded = expandedId === crew.id;
            const members = membersByCrew[crew.id];
            const isLoadingMembers = !!membersLoading[crew.id];
            return (
              <div key={crew.id} className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h2 className="text-base font-semibold text-text-primary">{crew.name}</h2>
                    <p className="text-xs text-text-muted mt-1">
                      {crew.memberCount} member{crew.memberCount !== 1 ? 's' : ''} ·{' '}
                      {crew.creatorUsername ? `Created by @${crew.creatorUsername}` : 'Created by a deleted user'} ·{' '}
                      {crew.festivalName ?? 'Archived festival'} · {new Date(crew.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleExpand(crew.id)}
                      className="text-xs px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors"
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                    <button
                      onClick={() => handleDelete(crew.id)}
                      className="text-xs px-3 py-1.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-glass-border space-y-3">
                    <div>
                      <p className="text-xs text-text-muted">Crew ID: {crew.id}</p>
                      {crew.inviteCode && (
                        <p className="text-xs text-text-muted flex items-center gap-2">
                          <span>Invite code {crew.inviteCode}</span>
                          <button
                            onClick={() => copyInviteCode(crew.inviteCode!)}
                            className="px-2 py-0.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors"
                          >
                            Copy
                          </button>
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-text-primary">Members</h4>
                        <button
                          onClick={() => setPickerCrewId(crew.id)}
                          className="text-xs px-3 py-1.5 rounded-md bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors"
                        >
                          Add member
                        </button>
                      </div>
                      {isLoadingMembers && !members ? (
                        <p className="text-xs text-text-muted italic">Loading members…</p>
                      ) : !members || members.length === 0 ? (
                        <p className="text-xs text-text-muted italic">No members.</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {members.map((m) => (
                            <li key={m.userId} className="flex items-center gap-2 text-xs text-text-secondary">
                              {memberAvatarUrl(m) ? (
                                <img
                                  src={memberAvatarUrl(m)!}
                                  alt=""
                                  width={24}
                                  height={24}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-6 h-6 rounded-full object-cover bg-bg-primary"
                                />
                              ) : (
                                <div
                                  className="w-6 h-6 rounded-full bg-bg-primary border border-glass-border flex items-center justify-center text-[10px] text-text-muted"
                                  aria-hidden="true"
                                >
                                  {(m.username || m.userId || '?').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="text-text-primary">{m.username || m.userId}</span>
                              <span className="text-text-muted">· {m.role || 'member'}</span>
                              {m.role === 'owner' ? (
                                <span className="ml-auto text-text-muted">Owner</span>
                              ) : (
                                <button
                                  onClick={() => setRemoveTarget({ crewId: crew.id, member: m })}
                                  className="ml-auto px-2 py-0.5 rounded-md bg-accent-coral/20 text-accent-coral hover:bg-accent-coral/30 transition-colors"
                                >
                                  Remove
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <UserPickerDialog
        open={!!pickerCrew}
        onOpenChange={(o) => !o && setPickerCrewId(null)}
        title={`Add a member to ${pickerCrew?.name ?? ''}`}
        existingUserIds={(pickerCrew && membersByCrew[pickerCrew.id]?.map((m) => m.userId)) || []}
        fullMessage={pickerCrew && pickerCrew.memberCount >= pickerCrew.maxMembers ? `This crew is full (${pickerCrew.maxMembers} members).` : null}
        onPick={handlePick}
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        title={removeCopy?.title || ''}
        description={removeCopy?.message}
        confirmLabel={removeCopy?.confirmLabel}
        destructive
        busy={removeBusy}
        onConfirm={doRemove}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={confirmDelete?.title || ''}
        description={confirmDelete?.description}
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        onConfirm={doDelete}
      />
    </div>
  );
}
