import { AUTH_COPY } from '@festie/shared/constants';
import { isValidEmail, usernameError } from '@festie/shared/utils';

export interface RegisterFields {
  username: string;
  password: string;
  confirmPassword: string;
  email: string;
  dateOfBirth: string;
  tosAccepted: boolean;
}

export type RegisterField = keyof RegisterFields;
export type RegisterErrors = Partial<Record<RegisterField, string>>;

/** Field order on screen; the first invalid field in this order takes focus. */
export const REGISTER_FIELD_ORDER: RegisterField[] = [
  'username',
  'password',
  'confirmPassword',
  'dateOfBirth',
  'email',
  'tosAccepted',
];

// UX-only check; the backend Zod schema is the authoritative 18+ gate.
function isAtLeast18(iso: string): boolean {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const t = new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate()));
  return t.getTime() <= Date.now();
}

/** Collects every field error at once so the user can fix the form in one pass. */
export function validateRegister(f: RegisterFields): RegisterErrors {
  const errors: RegisterErrors = {};
  if (!f.username) errors.username = 'Username is required';
  else {
    const rule = usernameError(f.username);
    if (rule) errors.username = rule;
  }
  if (!f.password) errors.password = 'Password is required';
  else if (f.password.length < 8) errors.password = 'Password must be at least 8 characters';
  if (f.password && f.password !== f.confirmPassword) errors.confirmPassword = 'Passwords do not match';
  if (!f.dateOfBirth) errors.dateOfBirth = 'Date of birth is required';
  else if (!isAtLeast18(f.dateOfBirth)) errors.dateOfBirth = 'You must be at least 18 to use Festie';
  if (!f.email) errors.email = AUTH_COPY.emailRequired;
  else if (!isValidEmail(f.email)) errors.email = 'Please enter a valid email address';
  if (!f.tosAccepted) errors.tosAccepted = 'You must accept the Terms of Service and Privacy Policy';
  return errors;
}

export function firstInvalidField(errors: RegisterErrors): RegisterField | undefined {
  return REGISTER_FIELD_ORDER.find((k) => errors[k]);
}
