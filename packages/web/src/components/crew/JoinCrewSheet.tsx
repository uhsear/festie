import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useFestivalStore } from '@festie/shared/stores';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { useInvitePreview, useJoinCrewByInvite } from '@festie/shared/hooks';
import { describeInvitePreview, inviteStatusMessage } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import Sheet from '../ui/Sheet';
import Button from '../ui/Button';

interface JoinCrewSheetProps {
  code: string | null;
  onClose: () => void;
}

/**
 * Invite confirmation: shows the crew, festival and spots left before the one
 * Join tap. Opens while `code` is set; reached by ?joinCrew= links and the
 * join-by-code prompt on /crew.
 */
export default function JoinCrewSheet({ code, onClose }: JoinCrewSheetProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { status, preview } = useInvitePreview(code);
  const joinByInvite = useJoinCrewByInvite();
  const currentFestivalId = useFestivalStore((s) => s.currentFestival?.id);
  const [busy, setBusy] = useState(false);

  const lines = preview ? describeInvitePreview(preview) : null;
  const full = preview?.spotsLeft === 0;
  const unusable = status === 'invalid' || status === 'expired';
  const switchNote =
    preview?.festivalId && preview.festivalName && preview.festivalId !== currentFestivalId
      ? `Joining switches you to ${preview.festivalName}.`
      : null;
  const statusMessage = inviteStatusMessage(status, true);

  const handleJoin = async () => {
    if (!code) return;
    setBusy(true);
    try {
      const outcome = await joinByInvite(code);
      if (outcome.kind === 'joined') {
        toast(`Joined ${outcome.crew.name}`, 'success');
        navigate({ to: '/crew', search: { tab: 'members' } });
      } else if (outcome.kind === 'already') {
        toast(`You're already in ${outcome.crew.name}`, 'info');
        navigate({ to: '/crew', search: { tab: 'members' } });
      } else {
        toast("We'll join you when you're back online.", 'info');
      }
    } catch {
      toast(useCrewStore.getState().error || "Couldn't join this crew. Try again.", 'error', 5000);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  return (
    <Sheet
      open={!!code}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={lines?.title ?? 'Crew invite'}
      description={lines?.stateLine}
    >
      <div className="space-y-1 text-sm text-text-secondary">
        {lines?.festivalLine && <p>{lines.festivalLine}</p>}
        {lines?.ownerLine && <p>{lines.ownerLine}</p>}
        <p>Crew members can see your picks and your status.</p>
        {switchNote && <p>{switchNote}</p>}
        {statusMessage && <p role="status">{statusMessage}</p>}
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
          Not now
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={unusable || full}
          isLoading={busy}
          onClick={handleJoin}
        >
          {full ? 'Crew is full' : 'Join crew'}
        </Button>
      </div>
    </Sheet>
  );
}
