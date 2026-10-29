/** "asir@example.com" -> "a@…e.com": first letter of the local part plus the last 5 characters of the domain. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '…';
  return `${email[0]}@…${email.slice(at + 1).slice(-5)}`;
}
