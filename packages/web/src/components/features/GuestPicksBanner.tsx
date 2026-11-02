import { useNavigate } from '@tanstack/react-router';
import { GUEST_PROMPT_COPY } from '@festie/shared/constants';
import Button from '../ui/Button';

const COPY = GUEST_PROMPT_COPY.guestPicks;

/** Tells a signed-out guest their picks live on this device and offers sign-up. */
export default function GuestPicksBanner() {
  const navigate = useNavigate();
  return (
    <div
      role="region"
      aria-label="Save your picks"
      className="w-full mb-3 rounded-xl border border-border-light bg-bg-card p-4 text-left"
    >
      <p className="font-display text-lg font-bold text-text-primary">{COPY.title}</p>
      <p className="mt-1 text-[length:var(--font-size-14)] text-text-secondary">{COPY.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" type="button" onClick={() => navigate({ to: '/register' })}>
          {COPY.cta}
        </Button>
        <Button variant="ghost" type="button" onClick={() => navigate({ to: '/login' })}>
          {COPY.signIn}
        </Button>
      </div>
    </div>
  );
}
