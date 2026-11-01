import { useState } from 'react';
import { useInvitePreview } from '@festie/shared/hooks';
import { describeInvitePreview, inviteStatusMessage } from '@festie/shared/utils';
import { readPendingInviteCode } from './invite';

/**
 * Tells a guest what they are joining. Renders nothing unless the visit carries
 * an invite code, so it is safe to place on every auth screen.
 */
export default function InviteBanner() {
  const [code] = useState(readPendingInviteCode);
  const { status, preview } = useInvitePreview(code);

  if (!code || status === 'loading') return null;

  const box = 'w-full max-w-[360px] mb-6 rounded-xl border border-border-light bg-bg-card p-4 text-left relative z-[1]';
  if (status !== 'ready' || !preview) {
    return (
      <div className={box} role="status">
        <p className="text-[length:var(--font-size-14)] text-text-secondary">{inviteStatusMessage(status, false)}</p>
      </div>
    );
  }

  const { title, stateLine, festivalLine, ownerLine } = describeInvitePreview(preview);
  const line = 'mt-1 text-[length:var(--font-size-14)] text-text-secondary';
  return (
    <div className={box} role="status" aria-label="Crew invitation">
      <p className="text-[length:var(--font-size-12)] font-medium uppercase tracking-wide text-text-muted">
        You're invited
      </p>
      <p className="mt-1 font-display text-xl font-bold text-text-primary">{title}</p>
      <p className={line}>{stateLine}</p>
      {festivalLine && <p className={line}>{festivalLine}</p>}
      {ownerLine && <p className={line}>{ownerLine}</p>}
      <p className="mt-2 text-[length:var(--font-size-14)] text-text-secondary">
        Create an account or sign in, then confirm to join this crew.
      </p>
    </div>
  );
}
