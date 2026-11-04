import React, { useState, useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useCrewStore } from '@festie/shared/stores';
import { useAuthStore, useUIStore } from '@festie/shared/stores';
import { useFestivalStore } from '@festie/shared/stores';
import CrewSelector from '../components/features/CrewSelector';
import FreshnessChip from '../components/features/FreshnessChip';
import CrewHeader from '../components/crew/CrewHeader';
import CrewSkeleton from '../components/ui/skeletons/CrewSkeleton';
import OfflineStatusChip from '../components/features/OfflineStatusChip';
import LastSyncedBadge from '../components/features/LastSyncedBadge';
import SosRaiseButton from '../components/crew/SosRaiseButton';
import EmptyState from '../components/ui/EmptyState';
import { Card } from '../components/ui/Card';
import HomeBaseCard from '../components/crew/HomeBaseCard';
import CrewTotemCard from '../components/crew/CrewTotemCard';
import CrewPhotosCard from '../components/crew/CrewPhotosCard';
import CrewInviteBar from '../components/crew/CrewInviteBar';
import JoinCrewSheet from '../components/crew/JoinCrewSheet';
import ReformCrewButton from '../components/crew/ReformCrewButton';
import CrewTabBar from '../components/crew/CrewTabBar';
import CrewTabContent from '../components/crew/CrewTabContent';
import CreateCrewDialog from '../components/crew/CreateCrewDialog';
import HandOverDialog from '../components/crew/HandOverDialog';
import IconButton from '../components/ui/IconButton';
import GuestTeaser from '../components/features/GuestTeaser';
import { useCrewAdmin } from '../components/crew/useCrewAdmin';
import { useToast } from '../lib/toastContext';
import PromptDialog from '../components/ui/PromptDialog';
import UserPickerDialog from '../components/admin/UserPickerDialog';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useActiveCrew } from '@festie/shared/hooks';
import { balancesQueryOptions, pollsQueryOptions } from '../hooks/useCrewAttention';
import {
  DEFAULT_CREW_TAB,
  balanceCents,
  openPollIds,
  crewCopy,
  deleteCrewConfirmMessage,
  handOverCandidates,
  leaveCrewConfirmMessage,
  parseInviteCode,
  removeMemberConfirmMessage,
} from '@festie/shared/utils';
import type { Crew, CrewMember } from '@festie/shared/types';
import type { CrewTabKey } from '@festie/shared/utils';

interface CrewWithHomeBase extends Crew {
  createdBy?: string;
}

export default function CrewView() {
  return (
    <RenderErrorBoundary name="crew">
      <CrewViewInner />
    </RenderErrorBoundary>
  );
}

function CrewViewInner() {
  const user = useAuthStore((state) => state.user);
  const crews = useCrewStore((state) => state.crews);
  const activeCrew = useCrewStore((state) => state.activeCrew);
  const selectCrew = useCrewStore((state) => state.selectCrew);
  const updateCrew = useCrewStore((state) => state.updateCrew);
  const handOverAndLeave = useCrewStore((state) => state.handOverAndLeave);
  const leaveCrew = useCrewStore((state) => state.leaveCrew);
  const deleteCrew = useCrewStore((state) => state.deleteCrew);
  const kickMember = useCrewStore((state) => state.kickMember);
  const transferOwnership = useCrewStore((state) => state.transferOwnership);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const festivals = useFestivalStore((state) => state.festivals);
  const loadFestivals = useFestivalStore((state) => state.loadFestivals);
  const { toast, toastError } = useToast();
  const navigate = useNavigate();
  // /crew?tab=<key> keeps the tab across reloads and shared links.
  // /crew?sos=<userId> (SOS banner) opens Find with the map aimed at that raiser.
  const { sos: focusSosUserId, tab: tabParam, start } = useSearch({ from: '/crew' });
  const tab: CrewTabKey = focusSosUserId ? 'find' : (tabParam ?? DEFAULT_CREW_TAB);
  const handleTabChange = (next: CrewTabKey) => {
    navigate({ to: '/crew', search: { tab: next }, replace: true });
  };

  const { isAdmin, adminOpen, setAdminOpen, adminAddBusy, submitForceAdd, handleForceAdd } = useCrewAdmin(
    user,
    activeCrew?.id,
    activeCrew?.name,
    toast,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [sheetCode, setSheetCode] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<'leave' | 'delete' | null>(null);
  const [handOverOpen, setHandOverOpen] = useState(false);
  const [handOverBusy, setHandOverBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [kickTarget, setKickTarget] = useState<CrewMember | null>(null);
  const [transferTarget, setTransferTarget] = useState<CrewMember | null>(null);

  const { status, retry } = useActiveCrew();

  // Group labels in the crew picker need festival names; crews of every festival load at once.
  useEffect(() => {
    if (user && crews.length > 0 && festivals.length === 0) loadFestivals().catch(() => {});
  }, [user?.id, crews.length, festivals.length, loadFestivals]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab badge counts. These reuse the exact query keys + endpoints the Polls
  // and Expenses tabs use, so the data is shared from the react-query cache
  // (no extra backend calls beyond what the crew detail view already makes).
  // Declared before the early return below to keep hook order stable.
  const activeCrewId = activeCrew?.id;
  const userId = user?.id;
  const { data: openPollCount = 0 } = useQuery({
    ...pollsQueryOptions(activeCrewId),
    select: (list) => list.filter((p) => !p.closed).length,
  });
  const { data: hasUnsettledBalance = false } = useQuery({
    ...balancesQueryOptions(activeCrewId),
    select: (balances) => Math.abs(balances.find((b) => b.userId === userId)?.balance ?? 0) > 0.01,
  });
  // Raw lists (same cache entries, no extra request) feed the Crew tab badge's "seen" marks.
  const { data: rawPolls } = useQuery(pollsQueryOptions(activeCrewId));
  const { data: rawBalances } = useQuery(balancesQueryOptions(activeCrewId));
  const markCrewBadgeSeen = useUIStore((state) => state.markCrewBadgeSeen);
  useEffect(() => {
    if (!activeCrewId) return;
    if (tab === 'plan' && rawPolls) markCrewBadgeSeen(activeCrewId, { pollIds: openPollIds(rawPolls) });
    if (tab === 'money' && rawBalances) {
      const mine = rawBalances.find((b) => b.userId === userId)?.balance;
      markCrewBadgeSeen(activeCrewId, { balanceCents: balanceCents(mine) });
    }
  }, [activeCrewId, tab, rawPolls, rawBalances, userId, markCrewBadgeSeen]);

  // /crew?start=create|join (from the intro) opens that prompt once, then drops the param.
  useEffect(() => {
    if (!user || !start) return;
    if (start === 'create') setCreateOpen(true);
    else setJoinOpen(true);
    navigate({ from: '/crew', to: '/crew', search: (prev) => ({ ...prev, start: undefined }), replace: true });
  }, [user?.id, start]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user)
    return (
      <>
        <h1 className="sr-only">Crew</h1>
        <GuestTeaser mode="crew" />
      </>
    );

  const handleSelectCrew = (crewId: string) => {
    selectCrew(crewId).catch((e: unknown) => {
      toastError(e, "Couldn't select crew. Try again.");
    });
  };
  const handleCreateCrew = () => setCreateOpen(true);

  const handleJoinCrew = () => setJoinOpen(true);
  const submitJoinCrew = (input: string) => {
    const code = parseInviteCode(input);
    if (!code) {
      toast("That code doesn't look right. Codes have 6 letters and numbers.", 'error');
      return;
    }
    setJoinOpen(false);
    setSheetCode(code);
  };

  const submitDestroy = async () => {
    if (!activeCrew || !confirmKind) return;
    const deleting = confirmKind === 'delete';
    setConfirmBusy(true);
    try {
      if (deleting) {
        await deleteCrew(activeCrew.id);
        toast('Crew deleted', 'success');
      } else {
        await leaveCrew(activeCrew.id);
        toast('Left crew', 'success');
      }
      setConfirmKind(null);
    } catch (e) {
      toastError(e, deleting ? "Couldn't delete crew. Try again." : "Couldn't leave crew. Try again.");
    } finally {
      setConfirmBusy(false);
    }
  };

  // Members leave directly. An owner with company picks a successor first; a solo owner can only delete.
  const handleLeaveCrew = () => {
    if (!isOwner) setConfirmKind('leave');
    else if (handOverCandidates(members, user.id).length === 0) setConfirmKind('delete');
    else setHandOverOpen(true);
  };

  const submitHandOver = async (newOwnerId: string) => {
    if (!activeCrew) return;
    const heir = members.find((m) => m.userId === newOwnerId);
    const heirName = heir?.name || heir?.username || 'Your pick';
    setHandOverBusy(true);
    try {
      const outcome = await handOverAndLeave(activeCrew.id, newOwnerId);
      if (outcome === 'left') toast(crewCopy.handedOverAndLeft(activeCrew.name, heirName), 'success');
      else toast(crewCopy.handOverPartial(activeCrew.name, heirName), 'error');
      setHandOverOpen(false);
    } catch (e) {
      toastError(e, "Couldn't hand over the crew. Try again.");
    } finally {
      setHandOverBusy(false);
    }
  };

  const submitRename = async (name: string) => {
    if (!activeCrew) return;
    try {
      await updateCrew(activeCrew.id, { name });
      toast(crewCopy.renamed, 'success');
      setRenameOpen(false);
    } catch (e) {
      toastError(e, "Couldn't rename crew. Try again.");
    }
  };

  const handleTransferOwnership = (member: CrewMember) => {
    if (!activeCrew) return;
    setTransferTarget(member);
  };

  const submitTransferOwnership = () => {
    if (!activeCrew || !transferTarget) return;
    const name = transferTarget.name || transferTarget.username || 'Member';
    transferOwnership(activeCrew.id, transferTarget.userId)
      .then(() => selectCrew(activeCrew.id))
      .then(() => toast(crewCopy.transferred(name), 'success'))
      .catch((e: unknown) => {
        toastError(e, "Couldn't transfer ownership. Try again.");
      })
      .finally(() => setTransferTarget(null));
  };

  const handleKick = (member: CrewMember) => {
    if (!activeCrew) return;
    setKickTarget(member);
  };

  const submitKick = () => {
    if (!activeCrew || !kickTarget) return;
    const name = kickTarget.name || kickTarget.username || 'Member';
    kickMember(activeCrew.id, kickTarget.userId)
      .then(() => selectCrew(activeCrew.id))
      .then(() => toast(crewCopy.removed(name), 'success'))
      .catch((e: unknown) => {
        toastError(e, "Couldn't remove member. Try again.");
      })
      .finally(() => setKickTarget(null));
  };

  const crew = activeCrew as CrewWithHomeBase | null;
  const members = crew?.members || [];
  const meMember = members.find((m) => m.userId === user.id);
  const isOwner = meMember?.role === 'owner' || crew?.createdBy === user.id || crew?.owner === user.id;

  return (
    <div className="crew-page space-y-4 pb-6 max-w-[600px] mx-auto min-w-0 w-full">
      {activeCrew ? (
        <CrewHeader crew={activeCrew} members={members} onOpenMembers={() => handleTabChange('members')} />
      ) : (
        <h1 className="sr-only">Crew</h1>
      )}

      {crews.length > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <CrewSelector
              crews={crews}
              selectedCrewId={activeCrew?.id}
              onSelectCrew={handleSelectCrew}
              onCreateCrew={handleCreateCrew}
              onJoinCrew={handleJoinCrew}
              festivals={festivals}
              currentFestivalId={currentFestival?.id}
            />
          </div>
          {activeCrew && isOwner && (
            <IconButton label="Rename crew" icon={<Pencil className="w-4 h-4" />} onClick={() => setRenameOpen(true)} />
          )}
        </div>
      )}

      {!activeCrew ? (
        status === 'loading' ? (
          <CrewSkeleton />
        ) : status === 'joining' ? (
          <Card padding="lg" className="space-y-4">
            <EmptyState
              illustration="noCrew"
              title="Joining when you're back online"
              description="Your join is saved on this device. The crew opens once you reconnect."
            />
          </Card>
        ) : status === 'error' ? (
          <Card padding="lg" className="space-y-4">
            <EmptyState
              illustration="noCrew"
              title="Couldn't load your crew"
              description="Check your connection, then try again."
              cta={{ label: 'Try again', onClick: retry }}
            />
          </Card>
        ) : (
          <Card padding="lg" className="space-y-4">
            <EmptyState
              illustration="noCrew"
              title="No crew yet"
              description="Plan with your friends. Make a crew, or join one with a code."
              cta={{ label: 'Create crew', onClick: handleCreateCrew }}
              secondaryCta={{ label: 'Join with code', onClick: handleJoinCrew }}
            />
          </Card>
        )
      ) : (
        <div className="crew-content space-y-4 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <FreshnessChip surface="crew" />
            <OfflineStatusChip />
            <LastSyncedBadge surface="crew" />
            <SosRaiseButton crewId={activeCrew.id} compact />
          </div>

          {members.length <= 1 && activeCrew.inviteCode && (
            <Card padding="md" className="space-y-2">
              <h2 className="text-base font-bold text-text-primary">{crewCopy.inviteCardTitle}</h2>
              <p className="text-sm text-text-secondary">{crewCopy.inviteCardBody(activeCrew.name)}</p>
              <CrewInviteBar
                inviteCode={activeCrew.inviteCode}
                crewId={activeCrew.id}
                crewName={activeCrew.name}
                isOwner={isOwner}
                expiresAt={activeCrew.inviteExpiresAt}
              />
            </Card>
          )}

          <HomeBaseCard
            crewId={activeCrew.id}
            currentLocation={crew?.homeBaseLocation ?? null}
            currentTime={crew?.homeBaseTime ?? null}
            isOwner={isOwner}
            onSaved={() => selectCrew(activeCrew.id)}
          />

          <CrewTabBar
            activeTab={tab}
            onTabChange={handleTabChange}
            badges={{ plan: openPollCount, money: hasUnsettledBalance }}
          />

          <CrewTabContent
            tab={tab}
            crewId={activeCrew.id}
            currentUserId={user.id}
            isOwner={isOwner}
            isAdmin={isAdmin}
            adminAddBusy={adminAddBusy}
            members={members}
            ownerId={activeCrew.owner}
            onForceAdd={handleForceAdd}
            onTransferOwnership={handleTransferOwnership}
            onKick={handleKick}
            onLeaveCrew={handleLeaveCrew}
            onDeleteCrew={() => setConfirmKind('delete')}
            maxMembers={crew?.maxMembers}
            focusSosUserId={focusSosUserId}
          />

          {/* Setup rows sit after the day-of content. */}
          <section aria-labelledby="crew-setup-heading" className="space-y-4 pt-2">
            <h2 id="crew-setup-heading" className="px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Plan and setup
            </h2>
            {activeCrew.inviteCode && members.length > 1 && (
              <CrewInviteBar
                inviteCode={activeCrew.inviteCode}
                crewId={activeCrew.id}
                crewName={activeCrew.name}
                isOwner={isOwner}
                expiresAt={activeCrew.inviteExpiresAt}
              />
            )}

            <CrewTotemCard
              crewId={activeCrew.id}
              totemName={crew?.totem_name ?? null}
              totemEmoji={crew?.totem_emoji ?? null}
              isOwner={isOwner}
              onSaved={() => selectCrew(activeCrew.id)}
            />

            <CrewPhotosCard
              crewId={activeCrew.id}
              currentUrl={crew?.photoAlbumUrl ?? null}
              onSaved={() => selectCrew(activeCrew.id)}
            />

            <ReformCrewButton
              crewId={activeCrew.id}
              sourceFestivalId={activeCrew.festivalId}
              crewName={activeCrew.name}
            />
          </section>
        </div>
      )}

      <CreateCrewDialog open={createOpen} onOpenChange={setCreateOpen} />
      <PromptDialog
        open={joinOpen}
        onOpenChange={setJoinOpen}
        title="Join crew"
        description="Type the 6-character code, or paste the invite link."
        placeholder="K7XQ2M"
        confirmLabel="Join"
        maxLength={64}
        parsePaste={parseInviteCode}
        onConfirm={submitJoinCrew}
      />
      <JoinCrewSheet code={sheetCode} onClose={() => setSheetCode(null)} />
      <UserPickerDialog
        open={adminOpen}
        onOpenChange={setAdminOpen}
        title={`Add a member to ${activeCrew?.name ?? 'this crew'}`}
        existingUserIds={members.map((m) => m.userId)}
        onPick={submitForceAdd}
      />
      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename crew"
        description="Everyone in the crew sees the new name."
        defaultValue={activeCrew?.name ?? ''}
        confirmLabel="Save"
        maxLength={60}
        onConfirm={submitRename}
      />
      <HandOverDialog
        open={handOverOpen}
        onOpenChange={setHandOverOpen}
        crewName={activeCrew?.name ?? ''}
        candidates={handOverCandidates(members, user.id)}
        busy={handOverBusy}
        onConfirm={submitHandOver}
      />
      <ConfirmDialog
        open={confirmKind !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmKind(null);
        }}
        title={confirmKind === 'delete' ? 'Delete crew' : 'Leave crew'}
        description={
          activeCrew
            ? confirmKind === 'delete'
              ? deleteCrewConfirmMessage(activeCrew.name, members.length)
              : leaveCrewConfirmMessage(activeCrew.name)
            : undefined
        }
        confirmLabel={confirmKind === 'delete' ? 'Delete crew' : 'Leave crew'}
        destructive
        busy={confirmBusy}
        onConfirm={submitDestroy}
      />
      <ConfirmDialog
        open={kickTarget !== null}
        onOpenChange={(open) => {
          if (!open) setKickTarget(null);
        }}
        title="Remove member"
        description={removeMemberConfirmMessage(
          kickTarget?.name || kickTarget?.username || 'this member',
          activeCrew?.name ?? 'this crew',
        )}
        confirmLabel="Remove"
        destructive
        onConfirm={submitKick}
      />
      <ConfirmDialog
        open={transferTarget !== null}
        onOpenChange={(open) => {
          if (!open) setTransferTarget(null);
        }}
        title="Transfer ownership"
        description={`Make ${transferTarget?.name || transferTarget?.username || 'this member'} the crew owner? You will become a regular member.`}
        confirmLabel="Make owner"
        onConfirm={submitTransferOwnership}
      />
    </div>
  );
}
