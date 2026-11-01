import { AUTH_COPY } from '../constants/authCopy';

// Source of truth: lib/helpers/validation.ts (backend username rule).
const USERNAME_RE = /^[a-zA-Z0-9_-]+( [a-zA-Z0-9_-]+)*$/;

/** Client-side copy of the server username rule. Returns an error message or null. */
export function usernameError(value: string): string | null {
  const v = value.trim();
  return v.length >= 2 && v.length <= 30 && USERNAME_RE.test(v) ? null : AUTH_COPY.usernameInvalid;
}

/** UX-only new-password check; the server still applies the full policy. */
export function validateNewPassword(
  password: string,
  confirm: string,
): { password?: string; confirmPassword?: string } {
  const errors: { password?: string; confirmPassword?: string } = {};
  if (!password) errors.password = 'Password is required';
  else if (password.length < 8) errors.password = 'Password must be at least 8 characters';
  else if (password !== confirm) errors.confirmPassword = 'Passwords do not match';
  return errors;
}

/** Which register field a server error message belongs to, or null for a form-level error. */
export function registerErrorField(message: string): 'username' | 'email' | 'password' | null {
  if (message.startsWith('Username')) return 'username';
  if (message.startsWith('Email')) return 'email';
  if (/password/i.test(message)) return 'password';
  return null;
}
