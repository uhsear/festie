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
  verifySent: 'Verification email sent',
  emailChange: 'Change',
  emailAdd: 'Add email',
  vibrationHint: 'Buzz on taps, saves and clashes. SOS alerts always vibrate.',
  emailPending: (email: string) => `Waiting for you to confirm ${email}. Check that inbox.`,
  verified: 'Verified',
  unverified: 'Unverified',
  emailAddPrompt: 'Add an email so you can reset your password.',
  emailNewLabel: 'New email',
  emailCurrentPasswordLabel: 'Current password',
  emailExplainer: 'We send a link to the new address. Your login email changes only when you open it.',
  emailSendLink: 'Send link',
  emailSent: (email: string) => `Check ${email} for a confirmation link. Your login email changes only when you open it.`,
  emailInvalid: 'Enter a valid email address.',
  emailSame: 'That is already your email.',
  emailPasswordRequired: 'Enter your current password.',
  emailSendFailed: "Couldn't send the link. Try again.",
  verifySendLink: 'Send link',
  verifyResendLink: 'Resend link',
  verifySendA11y: 'Send a confirmation link to your email',
  deleteFailed: "Couldn't delete account. Try again.",
  changePasswordFailed: "Couldn't change password. Try again.",
  devicesTitle: 'Signed-in devices',
  devicesHint: 'See where you are signed in',
  thisDevice: 'This device',
  unknownDevice: 'Unknown device',
  lastActive: (ago: string) => `Last active ${ago}`,
  signOutDevice: 'Sign out',
  signOutOthers: 'Sign out all other devices',
  signOutOthersTitle: 'Sign out all other devices?',
  signOutOthersBody: 'Every device except this one is signed out. They need your password to sign in again.',
  signOutOthersConfirm: 'Sign out others',
  onlyThisDevice: 'Only this device is signed in.',
  signedOutDevice: (name: string) => `Signed out ${name}.`,
  signedOutOthers: 'Signed out all other devices.',
  devicesLoadFailed: "Couldn't load your devices. Try again.",
  signOutFailed: "Couldn't sign that device out. Try again.",
  helpTitle: 'Help and legal',
  contactSupport: 'Contact support',
  contactSupportNoMail: (email: string) => `Write to ${email}.`,
  terms: 'Terms of service',
  privacy: 'Privacy policy',
  supportFestie: 'Support Festie',
  supportFestieHint: 'Chip in for the servers',
  installTitle: 'Install Festie',
  installHint: 'Add Festie to your home screen for push alerts and offline use.',
  installButton: 'Install',
  installHowTo: 'Show me how',
  installUnsupported: 'To install Festie, open festie.us in Safari on iPhone or Chrome on Android.',
  versionLine: (platform: string, version: string) => `Festie ${platform} · ${version}`,
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
