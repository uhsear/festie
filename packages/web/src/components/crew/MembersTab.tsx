import React, { useState } from 'react';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import { Users, UserPlus, Crown, ChevronDown, Trash2, LogOut } from 'lucide-react';
import { memberAvatarUrl, memberCountLabel } from '@festie/shared/utils';
import type { CrewMember } from '@festie/shared/types';

export interface MembersTabProps {
  members: CrewMember[];
  ownerId: string | undefined;
  isAdmin: boolean;
  adminAddBusy: boolean;
  onForceAdd: () => void;
  isOwner: boolean;
  currentUserId: string;
  onTransferOwnership: (member: CrewMember) => void;
  /** Owner-only kick. Optional so non-owner views can omit it. */
  onKick?: (member: CrewMember) => void;
  /** Opens the leave flow (every member). Omit to hide the Membership area. */
  onLeaveCrew?: () => void;
  /** Opens the delete confirm (owner only). Omit to hide the Danger zone. */
  onDeleteCrew?: () => void;
  maxMembers?: number;
}

export default function MembersTab({
  members,
  ownerId,
  isAdmin,
  adminAddBusy,
  onForceAdd,
  isOwner,
  currentUserId,
  onTransferOwnership,
  onKick,
  onLeaveCrew,
  onDeleteCrew,
  maxMembers,
}: MembersTabProps) {
  const [managingId, setManagingId] = useState<string | null>(null);
  return (
    <div className="space-y-1.5 px-4">
      {isAdmin && (
        <div className="py-1.5 px-2 rounded-md border border-border bg-bg-card flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="font-semibold">Admin</span>
          </div>
          <Button variant="outline" onClick={onForceAdd} disabled={adminAddBusy} className="!py-1 !px-2.5 text-xs">
            {adminAddBusy ? 'Adding…' : 'Force Add'}
          </Button>
        </div>
      )}
      {members.length > 0 ? (
        <>
        <div className="flex items-baseline justify-between px-1 pb-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Members</h3>
          <span className="text-xs text-text-secondary">{memberCountLabel(members.length, maxMembers)}</span>
        </div>
        <div className="space-y-0.5">
          {members.map((m, index) => {
            const memberIsOwner = m.role === 'owner' || ownerId === m.userId;
            const canManage = isOwner && !memberIsOwner && m.userId !== currentUserId;
            const canKick = canManage && !!onKick;
            const displayName = m.name || m.username || 'User';
            const open = managingId === m.userId;
            return (
              <div
                key={m.userId}
                className="stagger-item motion-reduce:!animate-none"
                style={{ '--i': Math.min(index, 6) } as React.CSSProperties}
              >
                <div className="crew-member-row relative py-2 px-2.5 rounded-md bg-bg-card border border-glass-border flex items-center gap-2.5">
                  <Avatar name={displayName} image={memberAvatarUrl(m)} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text-primary truncate">
                      {m.userId === currentUserId ? `${displayName} (you)` : displayName}
                    </div>
                    {memberIsOwner && (
                      <div className="text-xs text-text-secondary inline-flex items-center gap-1">
                        <Crown className="w-3 h-3" aria-hidden="true" /> Owner
                      </div>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      variant="outline"
                      onClick={() => setManagingId(open ? null : m.userId)}
                      aria-expanded={open}
                      aria-controls={`member-actions-${m.userId}`}
                      aria-label={`Manage ${displayName}`}
                      className="min-h-11 text-xs"
                    >
                      Manage
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </Button>
                  )}
                </div>
                {canManage && open && (
                  <div
                    id={`member-actions-${m.userId}`}
                    role="group"
                    aria-label={`Manage ${displayName}`}
                    className="flex gap-2 px-2.5 pb-2 pt-1.5"
                  >
                    <Button variant="outline" className="min-h-11 text-xs" onClick={() => onTransferOwnership(m)}>
                      Make owner
                    </Button>
                    {canKick && (
                      <Button variant="danger" className="min-h-11 text-xs" onClick={() => onKick!(m)}>
                        Remove from crew
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      ) : (
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="No members yet"
          description="Share the invite link — friends appear here the moment they join."
        />
      )}
      {onLeaveCrew && (
        <section aria-labelledby="crew-membership-heading" className="mt-6 pt-4 border-t border-border space-y-2">
          <h3 id="crew-membership-heading" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Membership
          </h3>
          <Button variant="outline" onClick={onLeaveCrew} className="min-h-11 text-sm text-[var(--color-text-danger)]">
            <LogOut className="w-4 h-4" aria-hidden="true" /> Leave crew…
          </Button>
        </section>
      )}
      {isOwner && onDeleteCrew && (
        <section aria-labelledby="crew-danger-heading" className="mt-4 pt-4 border-t border-border space-y-2">
          <h3 id="crew-danger-heading" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Danger zone
          </h3>
          <Button variant="outline" onClick={onDeleteCrew} className="min-h-11 text-sm text-[var(--color-text-danger)]">
            <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete crew…
          </Button>
          <p className="text-xs text-text-muted">Deletes the crew for everyone.</p>
        </section>
      )}
    </div>
  );
}
