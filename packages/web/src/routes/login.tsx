import React, { useState } from 'react';
import { useNavigate, useSearch, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { AUTH_COPY } from '@festie/shared/constants';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import AuthTabs from '../components/ui/AuthTabs';
import AuthBrand from '../components/auth/AuthBrand';
import InviteBanner from '../components/auth/InviteBanner';
import { cn } from '../lib/utils';

const authLinkClass = cn(
  'text-[length:var(--font-size-14)] text-accent-aqua underline underline-offset-2',
  'hover:text-[var(--color-accent-aqua-hover)]',
  'inline-flex items-center min-h-11 px-0 py-2.5',
  'rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua',
);

export default function LoginPage() {
  return (
    <RenderErrorBoundary name="login">
      <LoginPageInner />
    </RenderErrorBoundary>
  );
}

function LoginPageInner() {
  const navigate = useNavigate();
  const { login, isLoading } = useAuth();
  const { reset } = useSearch({ from: '/login' });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [usernameErr, setUsernameErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setUsernameErr('');
    setPasswordErr('');

    if (!username) {
      setUsernameErr('Username is required');
      return;
    }
    if (!password) {
      setPasswordErr('Password is required');
      return;
    }

    try {
      await login({ username, password });
      await navigate({ to: '/cards' });
    } catch (err) {
      // Read the thrown error, not the hook's `error`: that value comes from the
      // render before the request failed, so it is still null here.
      setFormError(mapErrorToUserMessage(err, 'Sign-in failed. Check your username and password and try again.'));
    }
  };

  return (
    <>
      <AuthBrand />

      <InviteBanner />

      <AuthTabs active="login" variant="pill" />

      {reset && (
        <div
          role="status"
          className="w-full max-w-[360px] mb-4 p-3 rounded-lg border border-accent-green/30 bg-accent-green/10 text-sm text-text-primary relative z-[1]"
        >
          {AUTH_COPY.passwordChanged}
        </div>
      )}

      <form
        className="w-full max-w-[360px] relative z-[1] text-left"
        onSubmit={handleSubmit}
        noValidate
        {...(isLoading ? { 'aria-busy': true } : {})}
      >
        {formError && (
          <div
            className="text-[var(--color-text-danger)] text-[length:var(--font-size-14)] mb-3 text-center"
            role="alert"
            aria-live="assertive"
          >
            {formError}
          </div>
        )}

        <div className="mb-3">
          <Input
            label="Username"
            autoComplete="username"
            maxLength={30}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isLoading}
            error={usernameErr}
          />
        </div>

        <div className="mb-3">
          <Input
            label="Password"
            isPassword
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            error={passwordErr}
          />
        </div>

        <Button variant="primary" fullWidth type="submit" disabled={isLoading} isLoading={isLoading}>
          {isLoading ? 'Signing in…' : AUTH_COPY.signIn}
        </Button>

        <div className="mt-3 flex flex-col items-center">
          <Link to="/forgot-password" className={authLinkClass}>
            Forgot password?
          </Link>
          <Link to="/cards" className={authLinkClass}>
            {AUTH_COPY.browseAsGuest}
          </Link>
        </div>
      </form>
    </>
  );
}
