import React, { useState } from 'react';
import { useNavigate, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { AUTH_COPY } from '@festie/shared/constants';
import { registerErrorField, usernameError } from '@festie/shared/utils';
import { useToast } from '../lib/toastContext';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import AuthTabs from '../components/ui/AuthTabs';
import AuthBrand from '../components/auth/AuthBrand';
import InviteBanner from '../components/auth/InviteBanner';
import {
  firstInvalidField,
  validateRegister,
  type RegisterErrors,
  type RegisterField,
} from '../components/auth/registerValidation';
import { cn } from '../lib/utils';

export default function RegisterPage() {
  return (
    <RenderErrorBoundary name="register">
      <RegisterPageInner />
    </RenderErrorBoundary>
  );
}

const FIELD_IDS: Record<RegisterField, string> = {
  username: 'register-username',
  password: 'register-password',
  confirmPassword: 'register-confirm-password',
  dateOfBirth: 'register-dob',
  email: 'register-email',
  tosAccepted: 'authTos',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

function RegisterPageInner() {
  const navigate = useNavigate();
  const { register, isLoading } = useAuth();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [formError, setFormError] = useState('');

  // Clears one field's error as soon as the user edits it.
  const clearError = (field: RegisterField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const found = validateRegister({ username, password, confirmPassword, email, dateOfBirth, tosAccepted });
    setErrors(found);
    const first = firstInvalidField(found);
    if (first) {
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }

    try {
      const { emailVerificationSent } = await register({
        username,
        password,
        confirmPassword,
        dateOfBirth,
        tosAccepted,
        email,
      });
      toast(
        emailVerificationSent
          ? `${AUTH_COPY.accountCreated}. ${AUTH_COPY.checkEmailToConfirm(email)}`
          : AUTH_COPY.accountCreated,
        'success',
        emailVerificationSent ? 6000 : undefined,
      );
      await navigate({ to: '/cards' });
    } catch (err) {
      // Read the thrown error, not the hook's `error`: that value comes from the
      // render before the request failed, so it is still null here.
      const msg = mapErrorToUserMessage(err, "Couldn't create your account. Try again.");
      const field = registerErrorField(msg);
      if (field) {
        setErrors((prev) => ({ ...prev, [field]: msg }));
        document.getElementById(FIELD_IDS[field])?.focus();
      } else {
        setFormError(msg);
      }
    }
  };

  const linkClass =
    'text-accent-aqua underline underline-offset-2 hover:text-[var(--color-accent-aqua-hover)] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

  return (
    <>
      <AuthBrand />

      <InviteBanner />

      <AuthTabs active="register" variant="split" />

      <form
        className="w-full max-w-[360px] relative z-[1] text-left"
        onSubmit={handleSubmit}
        noValidate
        {...(isLoading ? { 'aria-busy': true } : {})}
      >
        <div className="mb-3">
          <Input
            id={FIELD_IDS.username}
            label="Username"
            autoComplete="username"
            maxLength={30}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              clearError('username');
            }}
            disabled={isLoading}
            error={errors.username}
            helperText={AUTH_COPY.usernameHint}
            onBlur={() => {
              if (username) setErrors((prev) => ({ ...prev, username: usernameError(username) ?? undefined }));
            }}
          />
        </div>

        <div className="mb-3">
          <Input
            id={FIELD_IDS.password}
            label="Password"
            isPassword
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearError('password');
            }}
            disabled={isLoading}
            error={errors.password}
            helperText={AUTH_COPY.passwordHint}
          />
        </div>

        <div className="mb-3">
          <Input
            id={FIELD_IDS.confirmPassword}
            label="Confirm password"
            isPassword
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              clearError('confirmPassword');
            }}
            disabled={isLoading}
            error={errors.confirmPassword}
          />
        </div>

        <div className="mb-3">
          <Input
            id={FIELD_IDS.dateOfBirth}
            label="Date of birth"
            type="date"
            max={todayIso()}
            helperText="You must be 18 or older"
            value={dateOfBirth}
            onChange={(e) => {
              setDateOfBirth(e.target.value);
              clearError('dateOfBirth');
            }}
            disabled={isLoading}
            error={errors.dateOfBirth}
          />
        </div>

        <div className="mb-3">
          <Input
            id={FIELD_IDS.email}
            label={AUTH_COPY.emailLabel}
            type="email"
            helperText={AUTH_COPY.emailHint}
            autoComplete="email"
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearError('email');
            }}
            disabled={isLoading}
            error={errors.email}
          />
        </div>

        {/* TOS checkbox */}
        <label className="my-2.5 flex min-h-11 cursor-pointer items-start gap-2 text-[length:var(--font-size-14)] text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            id={FIELD_IDS.tosAccepted}
            checked={tosAccepted}
            onChange={(e) => {
              setTosAccepted(e.target.checked);
              clearError('tosAccepted');
            }}
            disabled={isLoading}
            aria-invalid={Boolean(errors.tosAccepted)}
            aria-describedby={errors.tosAccepted ? 'authTos-error' : undefined}
            className="auth-tos-checkbox mt-0.5 h-[22px] w-[22px] min-w-[22px] p-0"
          />
          <span>
            I agree to the{' '}
            <a href="/terms.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="/privacy.html" target="_blank" rel="noopener noreferrer" className={linkClass}>
              Privacy Policy
            </a>
          </span>
        </label>
        {errors.tosAccepted && (
          <p id="authTos-error" role="alert" className="text-sm text-[var(--color-text-danger)] mb-3">
            {errors.tosAccepted}
          </p>
        )}

        {formError && (
          <div
            className="text-[var(--color-text-danger)] text-[length:var(--font-size-14)] mb-3"
            role="alert"
            aria-live="assertive"
          >
            {formError}
          </div>
        )}

        <Button variant="primary" fullWidth type="submit" disabled={isLoading} isLoading={isLoading}>
          {isLoading ? 'Creating account…' : AUTH_COPY.createAccount}
        </Button>

        <div className="mt-3 flex flex-col items-center">
          <Link to="/cards" className={cn(linkClass, 'inline-flex items-center min-h-11 text-[length:var(--font-size-14)]')}>
            {AUTH_COPY.browseAsGuest}
          </Link>
        </div>
      </form>
    </>
  );
}
