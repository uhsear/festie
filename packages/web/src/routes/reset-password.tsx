import React, { useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useAuthStore } from '@festie/shared';
import { isResetLinkExpired, mapErrorToUserMessage } from '@festie/shared/services/api';
import { AUTH_COPY } from '@festie/shared/constants';
import { validateNewPassword } from '@festie/shared/utils';
import AuthBrand from '../components/auth/AuthBrand';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';

export default function ResetPasswordPage() {
  return (
    <RenderErrorBoundary name="reset-password">
      <ResetPasswordPageInner />
    </RenderErrorBoundary>
  );
}

function ResetPasswordPageInner() {
  const navigate = useNavigate();
  const { token } = useSearch({ from: '/reset-password' });

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmError, setConfirmError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const found = validateNewPassword(password, confirmPassword);
    setPasswordError(found.password ?? '');
    setConfirmError(found.confirmPassword ?? '');
    if (found.password || found.confirmPassword) return;

    setBusy(true);
    try {
      await useAuthStore.getState().resetPassword({ token, newPassword: password, confirmPassword });
      await navigate({ to: '/login', search: { reset: true }, replace: true });
    } catch (err) {
      if (isResetLinkExpired(err)) setExpired(true);
      else setPasswordError(mapErrorToUserMessage(err, "Couldn't reset your password. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <AuthBrand subtitle={AUTH_COPY.newPasswordTitle} />

        {!token || expired ? (
          <div className="bg-bg-card border border-border rounded-lg p-6 text-center space-y-4" role="status">
            <h2 className="text-lg font-semibold text-text-primary">{AUTH_COPY.expiredTitle}</h2>
            <p className="text-text-muted text-sm">{AUTH_COPY.expiredBody}</p>
            <Link
              to="/forgot-password"
              className="inline-flex w-full min-h-11 items-center justify-center rounded-lg bg-accent-aqua px-4 py-2 font-semibold text-[var(--text-on-light-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
            >
              {AUTH_COPY.sendNewLink}
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="bg-bg-card border border-border rounded-lg p-6 space-y-4 text-left"
          >
            <Input
              label={AUTH_COPY.newPasswordLabel}
              isPassword
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError('');
              }}
              error={passwordError}
              helperText={AUTH_COPY.passwordHint}
              disabled={busy}
            />
            <Input
              label={AUTH_COPY.confirmNewPasswordLabel}
              isPassword
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setConfirmError('');
              }}
              error={confirmError}
              disabled={busy}
            />
            <Button type="submit" variant="primary" fullWidth isLoading={busy} disabled={busy}>
              {AUTH_COPY.resetPasswordButton}
            </Button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-accent-aqua hover:opacity-75 transition-opacity">
            {AUTH_COPY.backToSignIn}
          </Link>
        </div>
      </div>
    </div>
  );
}
