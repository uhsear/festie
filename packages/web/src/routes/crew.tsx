import React, { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { useCrewStore } from '@festie/shared/stores';
import { useAuthStore } from '@festie/shared/stores';
import { useFestivalStore } from '@festie/shared/stores';
import CrewSelector from '../components/features/CrewSelector';
import FreshnessChip from '../components/features/FreshnessChip';
import CrewHeader from '../components/crew/CrewHeader';
import CrewSkeleton from '../components/ui/skeletons/CrewSkeleton';
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
import GuestTeaser from '../components/features/GuestTeaser';
import { useCrewAdmin } from '../components/crew/useCrewAdmin';
import { useToast } from '../lib/toastContext';
import PromptDialog from '../components/ui/PromptDialog';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { useActiveCrew } from '@festie/shared/hooks';
import {
  DEFAULT_CREW_TAB,
  deleteCrewConfirmMessage,
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
  const createCrew = useCrewStore((state) => state.createCrew);
  const leaveCrew = useCrewStore((state) => state.leaveCrew);
  const deleteCrew = useCrewStore((state) => state.deleteCrew);
  const kickMember = useCrewStore((state) => state.kickMember);
  const transferOwnership = useCrewStore((state) => state.transferOwnership);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const { toast, toastError } = useToast();
  const navigate = useNavigate();
  // /crew?tab=<key> keeps the tab across reloads and shared links.
  // /crew?sos=<userId> (SOS banner) opens Find with the map aimed at that raiser.
  const { sos: focusSosUserId, tab: tabParam } = useSearch({ from: '/crew' });
  const tab: CrewTabKey = focusSosUserId ? 'find' : (tabParam ?? DEFAULT_CREW_TAB);
  const handleTabChange = (next: CrewTabKey) => {
    navigate({ to: '/crew', search: { tab: next }, replace: true });
  };

  const { isAdmin, adminOpen, setAdminOpen, adminAddBusy, submitForceAdd, handleForceAdd } = useCrewAdmin(
    user,
    activeCrew?.id,
    toast,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [sheetCode, setSheetCode] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [kickTarget, setKickTarget] = useState<CrewMember | null>(null);
  const [transferTarget, setTransferTarget] = useState<CrewMember | null>(null);

  const { status, retry } = useActiveCrew();

  // Tab badge counts. These reuse the exact query keys + endpoints the Polls
  // and Expenses tabs use, so the data is shared from the react-query cache
  // (no extra backend calls beyond what the crew detail view already makes).
  // Declared before the early return below to keep hook order stable.
  const activeCrewId = activeCrew?.id;
  const userId = user?.id;
  const { data: openPollCount = 0 } = useQuery({
    queryKey: ['polls', activeCrewId],
    queryFn: async () => {
      const res = await api.get<{ polls: { closed?: boolean }[] } | { closed?: boolean }[]>(
        `/crews/${activeCrewId}/polls`,
      );
      return Array.isArray(res) ? res : res?.polls || [];
    },
    enabled: !!activeCrewId,
    select: (list) => list.filter((p) => !p.closed).length,
  });
  const { data: hasUnsettledBalance = false } = useQuery({
    queryKey: ['expense-balances', activeCrewId],
    queryFn: async () => {
      const res = await api.get<
        { userId: string; balance: number }[] | { balances: { userId: string; balance: number }[] }
      >(`/crews/${activeCrewId}/expenses/balances`);
      return Array.isArray(res) ? res : res?.balances || [];
    },
    enabled: !!activeCrewId,
    select: (balances) => Math.abs(balances.find((b) => b.userId === userId)?.balance ?? 0) > 0.01,
  });

  if (!user) return <GuestTeaser mode="crew" />;

  const handleSelectCrew = (crewId: string) => {
    selectCrew(crewId).catch((e: unknown) => {
      toastError(e, "Couldn't select crew. Try again.");
    });
  };
  const handleCreateCrew = () => setCreateOpen(true);
  const submitCreateCrew = async (name: string) => {
    setCreateBusy(true);
    try {
      await createCrew({ name, festivalId: currentFestival?.id });
      setCreateOpen(false);
    } catch (e) {
      toastError(e, "Couldn't create crew. Try again.");
    } finally {
      setCreateBusy(false);
    }
  };

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
    if (!activeCrew) return;
    setConfirmBusy(true);
    try {
      if (isOwner) {
        await deleteCrew(activeCrew.id);
        toast('Crew deleted', 'success');
      } else {
        await leaveCrew(activeCrew.id);
        toast('Left crew', 'success');
      }
      setConfirmOpen(false);
    } catch (e) {
      toastError(e, isOwner ? "Couldn't delete crew. Try again." : "Couldn't leave crew. Try again.");
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleTransferOwnership = (member: CrewMember) => {
    if (!activeCrew) return;
    setTransferTarget(member);
  };

  const submitTransferOwnership = () => {
    if (!activeCrew || !transferTarget) return;
    transferOwnership(activeCrew.id, transferTarget.userId)
      .then(() => selectCrew(activeCrew.id))
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
    kickMember(activeCrew.id, kickTarget.userId)
      .then(() => selectCrew(activeCrew.id))
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
      {activeCrew && (
        <CrewHeader crew={activeCrew} members={members} onOpenMembers={() => handleTabChange('members')} />
      )}

      {crews.length > 0 && (
        <CrewSelector
          crews={crews}
          selectedCrewId={activeCrew?.id}
          onSelectCrew={handleSelectCrew}
          onCreateCrew={handleCreateCrew}
          onJoinCrew={handleJoinCrew}
        />
      )}

      {!activeCrew ? (
        status === 'loading' ? (
          <CrewSkeleton />
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
            <SosRaiseButton crewId={activeCrew.id} compact />
          </div>

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
            onDestroyCrew={() => setConfirmOpen(true)}
            focusSosUserId={focusSosUserId}
          />

          {/* Setup rows sit after the day-of content. */}
          <section aria-labelledby="crew-setup-heading" className="space-y-4 pt-2">
            <h2 id="crew-setup-heading" className="px-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
              Plan and setup
            </h2>
            {activeCrew.inviteCode && (
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

      <PromptDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New crew"
        description="Give your crew a name. You can invite others after."
        placeholder="Sunset Squad"
        confirmLabel="Create"
        busy={createBusy}
        maxLength={60}
        onConfirm={submitCreateCrew}
      />
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
      <PromptDialog
        open={adminOpen}
        onOpenChange={setAdminOpen}
        title="Force add member"
        description="Admin only. Type a username or email to add them without an invite code."
        placeholder="username or email"
        confirmLabel="Add"
        busy={adminAddBusy}
        onConfirm={submitForceAdd}
      />
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={isOwner ? 'Delete crew' : 'Leave crew'}
        description={
          activeCrew
            ? isOwner
              ? deleteCrewConfirmMessage(activeCrew.name, members.length)
              : leaveCrewConfirmMessage(activeCrew.name)
            : undefined
        }
        confirmLabel={isOwner ? 'Delete crew' : 'Leave crew'}
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
