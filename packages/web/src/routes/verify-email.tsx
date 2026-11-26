import React, { useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { isApiClientError, mapErrorToUserMessage } from '@festie/shared/services/api';
import { AUTH_COPY } from '@festie/shared/constants';
import AuthBrand from '../components/auth/AuthBrand';
import Button from '../components/ui/Button';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

type Outcome = { kind: 'done'; moved: boolean } | { kind: 'dead'; message?: string } | null;

const linkClass =
  'inline-flex w-full min-h-11 items-center justify-center rounded-xl bg-accent-aqua px-4 py-2 font-semibold text-[var(--text-on-light-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

export default function VerifyEmailPage() {
  return (
    <RenderErrorBoundary name="verify-email">
      <VerifyEmailPageInner />
    </RenderErrorBoundary>
  );
}

function VerifyEmailPageInner() {
  const { token } = useSearch({ from: '/verify-email' });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [error, setError] = useState('');

  const confirm = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const { sessionsRevoked } = await useAuthStore.getState().verifyEmail(token);
      setOutcome({ kind: 'done', moved: sessionsRevoked });
    } catch (err) {
      // 400 = expired or already used, 409 = address taken: the link can never work again.
      if (isApiClientError(err) && (err.status === 400 || err.status === 409)) {
        setOutcome({ kind: 'dead', message: err.status === 409 ? err.message : undefined });
      } else {
        setError(mapErrorToUserMessage(err, "Couldn't confirm your email. Try again."));
      }
    } finally {
      setBusy(false);
    }
  };

  let card: React.ReactNode;
  if (!token || outcome?.kind === 'dead') {
    card = (
      <div className="bg-bg-card border border-border rounded-xl p-6 text-center space-y-4" role="status">
        <h2 className="text-lg font-semibold text-text-primary">
          {outcome?.kind === 'dead' && outcome.message ? AUTH_COPY.verifyEmailTakenTitle : AUTH_COPY.verifyEmailExpiredTitle}
        </h2>
        <p className="text-text-muted text-sm">{(outcome?.kind === 'dead' && outcome.message) || AUTH_COPY.verifyEmailExpiredBody}</p>
        <Link to="/login" className={linkClass}>
          {AUTH_COPY.backToSignIn}
        </Link>
      </div>
    );
  } else if (outcome?.kind === 'done') {
    card = (
      <div className="bg-bg-card border border-border rounded-xl p-6 text-center space-y-4" role="status">
        <h2 className="text-lg font-semibold text-text-primary">
          {outcome.moved ? AUTH_COPY.verifyEmailMovedTitle : AUTH_COPY.verifyEmailDone}
        </h2>
        <p className="text-text-muted text-sm">
          {outcome.moved ? AUTH_COPY.verifyEmailMovedBody : AUTH_COPY.verifyEmailDoneBody}
        </p>
        <Link to={outcome.moved ? '/login' : '/'} className={linkClass}>
          {outcome.moved ? AUTH_COPY.backToSignIn : AUTH_COPY.openFestie}
        </Link>
      </div>
    );
  } else {
    card = (
      <div className="bg-bg-card border border-border rounded-xl p-6 text-center space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">{AUTH_COPY.verifyEmailTitle}</h2>
        <p className="text-text-muted text-sm">{AUTH_COPY.verifyEmailBody}</p>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <Button type="button" variant="primary" fullWidth isLoading={busy} disabled={busy} onClick={confirm}>
          {AUTH_COPY.verifyEmailButton}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <AuthBrand subtitle={AUTH_COPY.verifyEmailTitle} />
        {card}
      </div>
    </div>
  );
}
