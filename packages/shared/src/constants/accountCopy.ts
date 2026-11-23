export const SUPPORT_EMAIL = 'support@festie.us';
export const SUPPORT_URL_TERMS = 'https://festie.us/terms';
export const SUPPORT_URL_PAYPAL = 'https://paypal.me/uhsear';

/** Quiet legal line for signed-out visitors. Paths are relative to the site origin; Help is the support mailbox. */
export const GUEST_LEGAL_COPY = {
  ariaLabel: 'Legal and help',
  privacy: 'Privacy',
  terms: 'Terms',
  help: 'Help',
  privacyPath: '/privacy.html',
  termsPath: '/terms.html',
  helpHref: `mailto:${SUPPORT_EMAIL}`,
} as const;
