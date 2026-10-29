import React from 'react';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import EmptyState from '../ui/EmptyState';
import { Users, UserPlus, Crown, UserMinus, Trash2, LogOut } from 'lucide-react';
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
  /** Opens the delete (owner) or leave (member) confirm. Omit to hide the danger area. */
  onDestroyCrew?: () => void;
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
  onDestroyCrew,
}: MembersTabProps) {
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
        <div className="space-y-0.5">
          {members.map((m, index) => {
            const memberIsOwner = m.role === 'owner' || ownerId === m.userId;
            const canManage = isOwner && !memberIsOwner && m.userId !== currentUserId;
            const canKick = canManage && !!onKick;
            const displayName = m.name || m.username || 'User';
            return (
              <div
                key={m.userId}
                className="crew-member-row stagger-item relative py-2 px-2.5 rounded-md bg-bg-card border border-glass-border flex items-center gap-2.5 motion-reduce:!animate-none"
                style={{ '--i': Math.min(index, 6) } as React.CSSProperties}
              >
                <Avatar name={displayName} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text-primary truncate">{m.name || m.username}</div>
                  {memberIsOwner && (
                    <div className="text-xs text-text-secondary inline-flex items-center gap-1">
                      <Crown className="w-3 h-3" aria-hidden="true" /> Owner
                    </div>
                  )}
                </div>
                {canManage && (
                  <Button
                    variant="outline"
                    onClick={() => onTransferOwnership(m)}
                    aria-label={`Make ${displayName} the owner`}
                    className="!py-1 !px-2.5 text-xs"
                  >
                    <Crown className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Make owner</span>
                  </Button>
                )}
                {canKick && (
                  <IconButton
                    label={`Remove ${displayName} from crew`}
                    variant="danger"
                    icon={<UserMinus className="w-4 h-4" />}
                    onClick={() => onKick!(m)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<Users className="w-12 h-12" aria-hidden="true" />}
          title="No members yet"
          description="Share the invite code below — they'll appear here the moment they join."
        />
      )}
      {onDestroyCrew && (
        <section aria-labelledby="crew-danger-heading" className="mt-6 pt-4 border-t border-border space-y-2">
          <h3 id="crew-danger-heading" className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {isOwner ? 'Danger zone' : 'Membership'}
          </h3>
          <Button
            variant="outline"
            onClick={onDestroyCrew}
            className="min-h-11 text-sm text-[var(--color-text-danger)]"
          >
            {isOwner ? (
              <>
                <Trash2 className="w-4 h-4" aria-hidden="true" /> Delete crew…
              </>
            ) : (
              <>
                <LogOut className="w-4 h-4" aria-hidden="true" /> Leave crew…
              </>
            )}
          </Button>
        </section>
      )}
    </div>
  );
}
