import React, { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import AuthBrand from '../components/auth/AuthBrand';
import { useToast } from '../lib/toastContext';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import { CheckCircle } from 'lucide-react';
import { cn } from '../lib/utils';

export default function ForgotPasswordPage() {
  return (
    <RenderErrorBoundary name="forgot-password">
      <ForgotPasswordPageInner />
    </RenderErrorBoundary>
  );
}

function ForgotPasswordPageInner() {
  const { forgotPassword, isLoading } = useAuth();
  const { toast } = useToast();

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
      toast('Password reset link sent to your email', 'success');
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
        {/* Logo — matches Header (FESTIE all-caps, display font)
           and /login + /register Tailwind logo heading. */}
        <div className="text-center mb-8 flex flex-col items-center">
          <AuthBrand />
          <h1
            className={cn(
              'font-display text-[clamp(22px,5vw,36px)] font-bold tracking-[6px] uppercase',
              'text-accent-coral mb-3 relative z-[1]',
              )}
          >
            FESTIE
          </h1>
          <p className="text-text-muted">Reset your password</p>
        </div>

        {!submitted ? (
          // Form
          <form onSubmit={handleSubmit} className="bg-bg-card border border-border rounded-lg p-6 space-y-4">
            <Input
              label="Email Address"
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
              Send Reset Link
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
              <p className="text-text-muted text-sm mb-4">
                We've sent a password reset link to <strong>{email}</strong>
              </p>
              <p className="text-text-muted text-xs">
                The link will expire in 1 hour. If you don't see it, check your spam folder.
              </p>
            </div>

            <Button variant="secondary" fullWidth onClick={() => setSubmitted(false)}>
              Try a different email
            </Button>
          </div>
        )}

        {/* Back to login */}
        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-accent-aqua hover:opacity-75 transition-opacity">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
