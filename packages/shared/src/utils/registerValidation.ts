import { AUTH_COPY } from '../constants/authCopy';
import { isValidEmail } from './email';
import { usernameError, validateNewPassword } from './authValidation';

export interface RegisterFields {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  /** 'YYYY-MM-DD', or '' when not picked */
  dateOfBirth: string;
  tosAccepted: boolean;
}
export type RegisterField = keyof RegisterFields;
export type RegisterErrors = Partial<Record<RegisterField, string>>;

export const REGISTER_COPY = {
  usernameRequired: 'Username is required',
  emailInvalid: 'Please enter a valid email address',
  dobRequired: 'Date of birth is required',
  under18: 'You must be at least 18 to use Festie',
  tosRequired: 'Accept the Terms of Service and Privacy Policy to continue',
} as const;

// UX-only 18+ guard; the backend Zod schema is the real gate.
export function isAtLeast18(isoDate: string, now: Date = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return false;
  const eighteenth = (Number(m[1]) + 18) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  return eighteenth <= now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

/** Collects every field error at once so the user can fix the form in one pass. */
export function validateRegister(f: RegisterFields, now: Date = new Date()): RegisterErrors {
  const errors: RegisterErrors = {};
  const username = f.username.trim();
  const usernameMessage = username ? usernameError(username) : REGISTER_COPY.usernameRequired;
  if (usernameMessage) errors.username = usernameMessage;
  const email = f.email.trim();
  if (!email) errors.email = AUTH_COPY.emailRequired;
  else if (!isValidEmail(email)) errors.email = REGISTER_COPY.emailInvalid;
  Object.assign(errors, validateNewPassword(f.password, f.confirmPassword));
  if (!f.dateOfBirth) errors.dateOfBirth = REGISTER_COPY.dobRequired;
  else if (!isAtLeast18(f.dateOfBirth, now)) errors.dateOfBirth = REGISTER_COPY.under18;
  if (!f.tosAccepted) errors.tosAccepted = REGISTER_COPY.tosRequired;
  return errors;
}

export function firstInvalidField(errors: RegisterErrors, order: readonly RegisterField[]): RegisterField | undefined {
  return order.find((k) => errors[k]);
}
