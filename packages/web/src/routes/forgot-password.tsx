import React, { useState } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { AUTH_COPY } from '@festie/shared/constants';
import AuthBrand from '../components/auth/AuthBrand';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { CheckCircle } from 'lucide-react';

export default function ForgotPasswordPage() {
  return (
    <RenderErrorBoundary name="forgot-password">
      <ForgotPasswordPageInner />
    </RenderErrorBoundary>
  );
}

function ForgotPasswordPageInner() {
  const { forgotPassword, isLoading } = useAuth();
  const { expired } = useSearch({ from: '/forgot-password' });

  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [serverError, setServerError] = useState('');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (emailError) {
      setEmailError('');
    }
  };

  const validate = () => {
    if (!email) {
      setEmailError('Email is required');
      return false;
    }
    if (!/^\S+@\S+\.[a-zA-Z]{2,}$/.test(email)) {
      setEmailError('Invalid email address');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setServerError('');
    if (!validate()) return;

    try {
      await forgotPassword({ email });
      setSubmitted(true);
    } catch (err) {
      // Read the thrown error, not the hook's `error`, which is still the value
      // from before the request failed.
      const msg = mapErrorToUserMessage(err, "We couldn't send the reset link right now. Please try again in a moment.");
      setServerError(msg);
    }
  };

  return (
    <div className="flex flex-col items-center px-4 py-12">
      <div className="w-full max-w-sm">
        <AuthBrand subtitle={AUTH_COPY.resetTitle} />

        {expired && !submitted && (
          <div
            role="status"
            className="mb-4 p-3 bg-bg-card border border-border rounded-lg text-sm text-text-primary text-left"
          >
            {AUTH_COPY.resetLinkExpired}
          </div>
        )}

        {!submitted ? (
          // Form
          <form onSubmit={handleSubmit} className="bg-bg-card border border-border rounded-lg p-6 space-y-4 text-left">
            <Input
              label={AUTH_COPY.emailLabel}
              name="email"
              type="email"
              value={email}
              onChange={handleChange}
              error={emailError}
              placeholder="you@example.com"
              disabled={isLoading}
              helperText="We'll send you a link to reset your password"
            />

            {serverError && !emailError && (
              <div role="alert" className="p-3 bg-accent-coral/10 border border-accent-coral/30 rounded-lg text-sm text-[var(--color-text-danger)]">
                {serverError}
              </div>
            )}

            <Button type="submit" variant="primary" fullWidth isLoading={isLoading} disabled={isLoading}>
              {AUTH_COPY.sendResetLink}
            </Button>
          </form>
        ) : (
          // Success message
          <div
            className="bg-bg-card border border-border rounded-lg p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-300"
            role="status"
            aria-live="polite"
          >
            <div className="flex justify-center">
              <CheckCircle className="w-12 h-12 text-accent-green" aria-hidden="true" />
            </div>

            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-2">Check your email</h2>
              <p className="text-text-muted text-sm mb-4">{AUTH_COPY.forgotSent(email)}</p>
              <p className="text-text-muted text-xs">{AUTH_COPY.forgotSentHint}</p>
            </div>

            <Button variant="secondary" fullWidth onClick={() => setSubmitted(false)}>
              {AUTH_COPY.useDifferentEmail}
            </Button>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-text-muted">
          {AUTH_COPY.noEmailHint.split(AUTH_COPY.supportEmail).map((part, i) =>
            i === 0 ? (
              <React.Fragment key={i}>
                {part}
                <a href={`mailto:${AUTH_COPY.supportEmail}`} className="text-accent-aqua underline underline-offset-2">
                  {AUTH_COPY.supportEmail}
                </a>
              </React.Fragment>
            ) : (
              part
            ),
          )}
        </p>

        {/* Back to login */}
        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-accent-aqua hover:opacity-75 transition-opacity">
            {AUTH_COPY.backToSignIn}
          </Link>
        </div>
      </div>
    </div>
  );
}
