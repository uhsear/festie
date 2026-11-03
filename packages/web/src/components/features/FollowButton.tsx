import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { Bell, BellRing } from 'lucide-react';
import { useAuthStore, useFollowStore } from '@festie/shared/stores';
import { DISCOVER_COPY, GUEST_PROMPT_COPY } from '@festie/shared/constants';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { useToast } from '../../lib/toastContext';

interface FollowButtonProps {
  festivalId: string;
  festivalName: string;
  size?: 'sm' | 'md';
}

/** Follow toggle for a festival. A guest gets a prompt to create an account or sign in. */
export default function FollowButton({ festivalId, festivalName, size = 'md' }: FollowButtonProps) {
  const user = useAuthStore((s) => s.user);
  const following = useFollowStore((s) => s.festivalIds.includes(festivalId));
  const loaded = useFollowStore((s) => s.loaded);
  const { toast, toastError } = useToast();
  const navigate = useNavigate();
  const { href } = useLocation();
  const [promptOpen, setPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || loaded) return;
    useFollowStore
      .getState()
      .load()
      .catch((err: unknown) => console.warn('Could not load followed festivals.', err));
  }, [user, loaded]);

  const copy = DISCOVER_COPY.follow;
  const handleClick = async () => {
    if (!user) {
      setPromptOpen(true);
      return;
    }
    const next = !following;
    setBusy(true);
    try {
      await useFollowStore.getState().setFollowing(festivalId, next);
      toast(next ? copy.followedToast(festivalName) : copy.unfollowedToast(festivalName), 'success');
    } catch (err) {
      toastError(err, copy.error);
    } finally {
      setBusy(false);
    }
  };

  const Icon = following ? BellRing : Bell;
  const guestCopy = GUEST_PROMPT_COPY.follow;
  return (
    <>
      <Button
        variant={following ? 'secondary' : 'primary'}
        size={size}
        disabled={busy}
        aria-pressed={following}
        aria-label={following ? copy.unfollowA11y(festivalName) : copy.followA11y(festivalName)}
        icon={<Icon className="w-4 h-4" aria-hidden="true" />}
        onClick={() => void handleClick()}
      >
        {following ? copy.following : copy.follow}
      </Button>
      <Dialog
        open={promptOpen}
        onOpenChange={setPromptOpen}
        title={guestCopy.title(festivalName)}
        description={guestCopy.message}
      >
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => navigate({ to: '/register', search: { next: href } })}>
            {GUEST_PROMPT_COPY.createAccount}
          </Button>
          <Button variant="secondary" onClick={() => navigate({ to: '/login', search: { next: href } })}>
            {GUEST_PROMPT_COPY.signIn}
          </Button>
          <Button variant="utility" onClick={() => setPromptOpen(false)}>
            {copy.notNow}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
