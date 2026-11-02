/**
 * Account settings contract shared by web and mobile. Each app maps
 * ACCOUNT_SECTIONS in order to its own section components, so the order and
 * the headings cannot drift between the two account pages.
 */
export const ACCOUNT_SECTIONS = [
  { id: 'account', label: 'Account' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'privacy', label: 'Privacy and sharing' },
  { id: 'offline', label: 'Offline and data' },
  { id: 'appearance', label: 'Appearance and accessibility' },
  { id: 'festivals', label: 'Your festivals' },
  { id: 'help', label: 'Help and legal' },
  { id: 'admin', label: 'Admin', adminOnly: true },
  { id: 'signOut', label: '' }, // rendered with no heading
  { id: 'danger', label: 'Danger zone' },
] as const;
export type AccountSectionId = (typeof ACCOUNT_SECTIONS)[number]['id'];

export const ACCOUNT_COPY = {
  title: 'Account',
  subtitle: 'Settings & preferences',
  motionNote: "Motion follows your device's Reduce Motion setting.",
  adminTitle: 'Admin',
  adminHint: 'Dashboard, activity & festivals',
  privacyTitle: 'Privacy Policy',
  privacyHint: 'How we handle your data',
  emailLabel: 'Email',
  emailNotSet: 'Not set',
  emailResend: 'Resend verification',
  emailSent: 'Verification email sent',
  emailChange: 'Change',
  emailAdd: 'Add email',
  emailPending: (email: string) => `Waiting for you to confirm ${email}. Check that inbox.`,
  verified: 'Verified',
  unverified: 'Unverified',
} as const;

export const AVATAR_COPY = {
  rules: 'JPG, PNG, GIF or WebP, up to 5 MB.',
  tooBig: 'Photo is over 5 MB. Choose a smaller one.',
  wrongType: 'Use a JPG, PNG, GIF or WebP photo.',
  uploading: 'Uploading photo…',
  removing: 'Removing photo…',
  updated: 'Photo updated',
  removed: 'Photo removed',
  uploadFailed: "Couldn't upload your photo. Try again.",
  removeFailed: "Couldn't remove your photo. Try again.",
  change: 'Change profile photo',
  add: 'Add a profile photo',
  remove: 'Remove photo',
  removeConfirmTitle: 'Remove photo?',
  removeConfirmBody: 'Your crew will see your initials instead.',
} as const;

export const THEME_MODE_OPTIONS = [
  { value: 'stage', label: 'Stage', hint: 'Dark, for night sets' },
  { value: 'daylight', label: 'Daylight', hint: 'High contrast for bright sun' },
  { value: 'system', label: 'Match system', hint: 'Follows your device' },
] as const;

export const PAYMENT_FIELDS = [
  { key: 'venmoHandle', method: 'venmo', label: 'Venmo username', prefix: '@', placeholder: 'your-venmo' },
  { key: 'cashappCashtag', method: 'cashapp', label: 'Cash App $cashtag', prefix: '$', placeholder: 'yourcashtag' },
  { key: 'paypalHandle', method: 'paypal', label: 'PayPal.me name', prefix: 'paypal.me/', placeholder: 'yourpaypal' },
] as const;

export const PAYMENT_COPY = {
  title: 'Payment handles',
  intro: 'Crewmates use these to pay you back when you settle up. All optional. Leave a field blank to hide it.',
  test: 'Test',
  testLabel: (label: string) => `Open your ${label} profile to check it`,
  saved: 'Payment handles updated',
  saveFailed: "Couldn't update payment handles. Try again.",
} as const;
