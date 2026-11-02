import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from '@tanstack/react-router';
import { useAuth } from '@festie/shared';
import { isApiClientError, mapErrorToUserMessage } from '@festie/shared/services/api';
import { AUTH_COPY, PROVIDER_COPY } from '@festie/shared/constants';
import { REGISTER_COPY, isAtLeast18, registerErrorField, safeReturnPath, usernameError } from '@festie/shared/utils';
import type { ProviderSignupPayload } from '@festie/shared/types';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import AuthBrand from '../components/auth/AuthBrand';
import { cn } from '../lib/utils';

type FieldName = 'username' | 'dateOfBirth' | 'tosAccepted';
type Errors = Partial<Record<FieldName, string>>;

const FIELD_IDS: Record<FieldName, string> = {
  username: 'finish-username',
  dateOfBirth: 'finish-dob',
  tosAccepted: 'authTos',
};
const FIELD_ORDER: FieldName[] = ['username', 'dateOfBirth', 'tosAccepted'];

const todayIso = () => new Date().toISOString().slice(0, 10);

const linkClass =
  'text-accent-aqua underline underline-offset-2 hover:text-[var(--color-accent-aqua-hover)] rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua';

export default function FinishSignupPage() {
  return (
    <RenderErrorBoundary name="finish-signup">
      <FinishSignupInner />
    </RenderErrorBoundary>
  );
}

function FinishSignupInner() {
  const navigate = useNavigate();
  const state = useLocation().state as (Partial<ProviderSignupPayload> & { next?: unknown }) | undefined;
  const payload = state?.signupToken ? (state as ProviderSignupPayload) : null;
  // Login's `next` (an invite or join link) rides along in router state; checked again like the search param.
  const next = safeReturnPath(state?.next) ?? undefined;

  useEffect(() => {
    if (!payload) void navigate({ to: '/login', replace: true });
  }, [payload, navigate]);

  if (!payload) return null;
  return <FinishForm payload={payload} next={next} />;
}

function FinishForm({ payload, next }: { payload: ProviderSignupPayload; next?: string }) {
  const navigate = useNavigate();
  const { completeProviderSignup } = useAuth();
  // The store action does not set isLoading, so track the request here.
  const [isLoading, setIsLoading] = useState(false);

  const [username, setUsername] = useState(payload.suggestedUsername);
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [expired, setExpired] = useState(false);

  const clearError = (field: FieldName) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const validate = (): Errors => {
    const found: Errors = {};
    const name = username.trim();
    const nameMessage = name ? usernameError(name) : REGISTER_COPY.usernameRequired;
    if (nameMessage) found.username = nameMessage;
    if (!dateOfBirth) found.dateOfBirth = REGISTER_COPY.dobRequired;
    else if (!isAtLeast18(dateOfBirth)) found.dateOfBirth = REGISTER_COPY.under18;
    if (!tosAccepted) found.tosAccepted = REGISTER_COPY.tosRequired;
    return found;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const found = validate();
    setErrors(found);
    const first = FIELD_ORDER.find((k) => found[k]);
    if (first) {
      document.getElementById(FIELD_IDS[first])?.focus();
      return;
    }

    setIsLoading(true);
    try {
      await completeProviderSignup({ signupToken: payload.signupToken, username: username.trim(), dateOfBirth, tosAccepted: true });
      await (next ? navigate({ href: next }) : navigate({ to: '/cards' }));
    } catch (err) {
      if (isApiClientError(err) && err.code === 'SIGNUP_EXPIRED') {
        setExpired(true);
        setFormError(PROVIDER_COPY.signupExpired);
        return;
      }
      const msg = mapErrorToUserMessage(err, "Couldn't create your account. Try again.");
      if (registerErrorField(msg) === 'username') {
        setErrors((prev) => ({ ...prev, username: msg }));
        document.getElementById(FIELD_IDS.username)?.focus();
      } else {
        setFormError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <AuthBrand subtitle={PROVIDER_COPY.finishTitle} />
      <p className="w-full max-w-[360px] mb-4 text-center text-text-secondary text-[length:var(--font-size-14)] relative z-[1]">
        {PROVIDER_COPY.finishBody}
      </p>

      <form
        className="w-full max-w-[360px] relative z-[1] text-left"
        onSubmit={handleSubmit}
        noValidate
        {...(isLoading ? { 'aria-busy': true } : {})}
      >
        <div className="mb-3">
          <Input
            id="finish-email"
            label={AUTH_COPY.emailLabel}
            value={payload.email ?? PROVIDER_COPY.privateRelay}
            readOnly
            disabled
          />
        </div>

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
            disabled={isLoading || expired}
            error={errors.username}
            helperText={AUTH_COPY.usernameHint}
            onBlur={() => {
              if (username) setErrors((prev) => ({ ...prev, username: usernameError(username.trim()) ?? undefined }));
            }}
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
            disabled={isLoading || expired}
            error={errors.dateOfBirth}
          />
        </div>

        <label className="my-2.5 flex min-h-11 cursor-pointer items-start gap-2 text-[length:var(--font-size-14)] text-[var(--color-text-secondary)]">
          <input
            type="checkbox"
            id={FIELD_IDS.tosAccepted}
            checked={tosAccepted}
            onChange={(e) => {
              setTosAccepted(e.target.checked);
              clearError('tosAccepted');
            }}
            disabled={isLoading || expired}
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
            {expired && (
              <>
                {' '}
                <Link to="/login" className={linkClass}>
                  Back to sign in
                </Link>
              </>
            )}
          </div>
        )}

        <Button variant="primary" fullWidth type="submit" disabled={isLoading || expired} isLoading={isLoading}>
          {PROVIDER_COPY.finishButton}
        </Button>

        <div className="mt-3 flex flex-col items-center">
          <Link to="/login" className={cn(linkClass, 'inline-flex items-center min-h-11 text-[length:var(--font-size-14)]')}>
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
