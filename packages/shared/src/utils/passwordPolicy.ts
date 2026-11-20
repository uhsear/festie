export const PASSWORD_RULES = 'Use 8 to 100 characters. Do not use a common password, your username or the first part of your email.';

// Copy of the server list in lib/helpers/validation.ts (source of truth); tests/password-policy-parity.test.ts checks both.
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '123123123', '111111111', '000000000',
  'qwerty123', 'qwertyuiop', 'qwerty12345', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx',
  'iloveyou', 'iloveyou1', 'admin123', 'administrator', 'welcome1', 'welcome123',
  'letmein1', 'letmein123', 'abc12345', 'abcd1234', 'baseball', 'football',
  'football1', 'sunshine', 'princess', 'princess1', 'dragon123', 'monkey123',
  'master123', 'superman1', 'trustno1', 'whatever1', 'starwars1', 'computer1',
  'michael1', 'jennifer', 'jordan23', 'hunter22', 'shadow123', 'ashley123',
  'login123', 'changeme', 'changeme1', 'secret123', 'samsung123', 'google123',
  'qazwsxedc', 'asdfghjkl', 'zxcvbnm1', 'q1w2e3r4', 'q1w2e3r4t5', 'passpass',
  'test1234', 'test12345', 'temp1234', 'demo1234', 'guest123', 'user1234',
  'festival', 'festival1', 'festie123', 'festival123',
]);

export function passwordPolicyError(
  value: string,
  ctx: { username?: string | null; email?: string | null } = {},
): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'Password is required';
  if (value.length < 8) return 'Password must be at least 8 characters';
  if (value.length > 100) return 'Password must be at most 100 characters';

  const lower = value.trim().toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return 'That password is too common — please choose something harder to guess';
  }

  const username = ctx.username?.trim().toLowerCase();
  if (username && username.length >= 3 && lower.includes(username)) {
    return 'Password must not contain your username';
  }

  const emailLocal = ctx.email?.split('@')[0]?.trim().toLowerCase();
  if (emailLocal && emailLocal.length >= 3 && lower.includes(emailLocal)) {
    return 'Password must not contain your email address';
  }

  return null;
}

export interface PasswordStrength {
  /** 0 (empty) to 4 (strong). Drives the meter segment count and label. */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

/**
 * Lightweight strength heuristic for the password meter. UX guidance only: passwordPolicyError
 * is authoritative. It rewards length and character variety so a user gets a nudge as they type, and it caps a password the policy rejects.
 */
export function passwordStrength(
  pw: string,
  ctx: { username?: string | null; email?: string | null } = {},
): PasswordStrength {
  if (!pw) return { score: 0, label: '' };
  // Anything under the 8-char floor can never read above "Too short".
  if (pw.length < 8) return { score: 1, label: 'Too short' };
  // A password the policy rejects must not read "Good" next to the policy error.
  if (passwordPolicyError(pw, ctx)) return { score: 1, label: 'Too guessable' };
  let points = 1;
  if (pw.length >= 12) points += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) points += 1;
  if (/\d/.test(pw)) points += 1;
  if (/[^A-Za-z0-9]/.test(pw)) points += 1;
  const score = Math.min(4, points) as 1 | 2 | 3 | 4;
  const label = (['', 'Weak', 'Fair', 'Good', 'Strong'] as const)[score];
  return { score, label };
}
