import { useEffect, useState } from 'react';
import { api } from '@festie/shared/services/api';
import { readPendingInviteCode } from './invite';

interface InvitePreview {
  crewName: string;
  ownerName: string | null;
  memberCount: number;
  expiresAt: string | null;
}

type State = { status: 'loading' } | { status: 'ready'; preview: InvitePreview } | { status: 'invalid' };

/**
 * Tells a guest who invited them. Renders nothing unless the visit carries an
 * invite code, so it is safe to place on every auth screen.
 */
export default function InviteBanner() {
  const [code] = useState(readPendingInviteCode);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    api
      .get<InvitePreview>(`/crews/join-preview/${encodeURIComponent(code)}`)
      .then((preview) => !cancelled && setState({ status: 'ready', preview }))
      .catch(() => !cancelled && setState({ status: 'invalid' }));
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (!code || state.status === 'loading') return null;

  const box = 'w-full max-w-[360px] mb-6 rounded-xl border border-border-light bg-bg-card p-4 text-left relative z-[1]';
  if (state.status === 'invalid') {
    return (
      <div className={box} role="status">
        <p className="text-[length:var(--font-size-14)] text-text-secondary">
          This invite link has expired or is no longer valid. You can still create an account, then ask the crew owner for
          a new link.
        </p>
      </div>
    );
  }

  const { crewName, ownerName, memberCount, expiresAt } = state.preview;
  const expiry = expiresAt ? new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  return (
    <div className={box} role="status" aria-label="Crew invitation">
      <p className="text-[length:var(--font-size-12)] font-medium uppercase tracking-wide text-text-muted">
        You are invited
      </p>
      <p className="mt-1 font-display text-xl font-bold text-text-primary">{crewName}</p>
      <p className="mt-1 text-[length:var(--font-size-14)] text-text-secondary">
        {ownerName ? `${ownerName} invited you. ` : ''}
        {memberCount} {memberCount === 1 ? 'member' : 'members'} so far.
        {expiry ? ` Invite valid until ${expiry}.` : ''}
      </p>
      <p className="mt-2 text-[length:var(--font-size-14)] text-text-secondary">
        Create an account or sign in, then confirm to join this crew.
      </p>
    </div>
  );
}
