export interface RegisterFields {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  dob: Date | null;
  tosAccepted: boolean;
}

export type RegisterField = 'username' | 'email' | 'password' | 'confirmPassword' | 'dob' | 'tosAccepted';
export type RegisterErrors = Partial<Record<RegisterField, string>>;

/** Field order on screen; the first invalid field in this order takes focus. */
export const REGISTER_FIELD_ORDER: RegisterField[] = [
  'username',
  'email',
  'password',
  'confirmPassword',
  'dob',
  'tosAccepted',
];

// UX-only 18+ guard; the backend Zod schema is authoritative.
export function isAtLeast18(d: Date, now: number = Date.now()): boolean {
  const cutoff = new Date(Date.UTC(d.getUTCFullYear() + 18, d.getUTCMonth(), d.getUTCDate()));
  return cutoff.getTime() <= now;
}

/** Collects every field error at once so the user can fix the form in one pass. */
export function validateRegister(f: RegisterFields, now: number = Date.now()): RegisterErrors {
  const errors: RegisterErrors = {};
  if (!f.username.trim()) errors.username = 'Username is required';
  // Email is required on mobile: it is the only way to recover a password.
  if (!f.email.trim()) errors.email = 'Email is required for password reset';
  if (!f.password.trim()) errors.password = 'Password is required';
  else if (f.password.length < 8) errors.password = 'Password must be at least 8 characters';
  if (f.password && f.password !== f.confirmPassword) errors.confirmPassword = 'Passwords do not match';
  if (!f.dob) errors.dob = 'Date of birth is required';
  else if (!isAtLeast18(f.dob, now)) errors.dob = 'You must be at least 18 to use Festie';
  if (!f.tosAccepted) errors.tosAccepted = 'Accept the Terms of Service and Privacy Policy to continue';
  return errors;
}

export function firstInvalidField(errors: RegisterErrors): RegisterField | undefined {
  return REGISTER_FIELD_ORDER.find((k) => errors[k]);
}
