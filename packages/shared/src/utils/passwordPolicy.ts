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
