// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { identifier, password } from './primitives';
import { authorizationCode, idToken, oauthNonce, providerName } from './auth';

// ════════════════════════════════════════════════════════════════════════════════
// Admin Schemas
// ════════════════════════════════════════════════════════════════════════════════

export const resetPasswordSchema = z.object({
  newPassword: password,
});

export const resetPasswordPublicSchema = z.object({
  // Any non-empty string: a truncated or mangled link must reach the handler and get TOKEN_EXPIRED
  // (the "link expired" card), not a field-level VALIDATION_ERROR the clients show under the password.
  token: z.string().min(1).max(4096),
  newPassword: password,
  confirmPassword: z.string().min(8).max(100),
});

export const verifyEmailSchema = z.object({
  token: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'Invalid token')
    .max(64),
});

// ════════════════════════════════════════════════════════════════════════════════
// Notification & Push Schemas
// ════════════════════════════════════════════════════════════════════════════════
// Throws RangeError for an unknown IANA zone, which Intl reports for a bad id.
export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
const dndTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM (24h)')
  .nullable();
export const notificationPrefsSchema = z
  .object({
    crewUpdates: z.boolean().optional(),
    setReminders: z.boolean().optional(),
    scheduleChanges: z.boolean().optional(),
    lineupDrops: z.boolean().optional(),
    crewReformed: z.boolean().optional(),
    wrapReady: z.boolean().optional(),
    crewMeetingPoints: z.boolean().optional(),
    crewPolls: z.boolean().optional(),
    crewMoney: z.boolean().optional(),
    crewRides: z.boolean().optional(),
    crewNudges: z.boolean().optional(),
    mustSeeReminderMinutes: z
      .union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)])
      .nullable()
      .optional(),
    dndStart: dndTime.optional(),
    dndEnd: dndTime.optional(),
    dndTimeZone: z.string().max(64).refine(isIanaTimeZone, { message: 'Invalid IANA time zone' }).nullable().optional(),
  })
  .strict();

export const pushTokenSchema = z.object({
  token: z.string().min(20).max(4096),
  platform: z.enum(['web', 'ios', 'android']).default('web'),
  deviceName: z.string().max(60).optional().nullable(),
  localRemindersFestivalId: z.string().min(1).max(128).nullable().optional(),
  localRemindersCoversUntil: z.number().int().nonnegative().max(8.64e15).nullable().optional(),
});

// ── Additional notification schemas ──────────────────────────────
export const deleteTokenSchema = z.object({
  token: z.string().min(1, 'Token required').max(4096),
});

export const markReadSchema = z.object({
  festivalId: z.string().max(100).optional(),
});

// ── Topic subscription schema ────────────────────────────────────
export const topicSubscriptionSchema = z
  .record(z.string(), z.boolean())
  .refine((d) => Object.keys(d).length > 0 && Object.keys(d).length <= 10, {
    message: 'At least one topic required, max 10',
  });

// ── Account schemas ───────────────────────────────────────────────
export const usernameChangeSchema = z.object({
  username: z.string().trim().min(1, 'Username required').max(40),
});

// Names reach push and email templates as well as escaped pages, so refuse markup at the door.
export const noMarkup = (s: string) => !/[<>]/.test(s);
export const noMarkupMsg = 'Names cannot contain < or >';

// Editable display name (friendly name). Username stays the immutable @handle.
export const displayNameChangeSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name required').max(50).refine(noMarkup, noMarkupMsg),
});

// Payment handles for settle-up deep links. All optional; an explicit empty
// string clears the handle (stored as NULL). Handles are short identifiers, not
// URLs — the deep-link builders prepend the scheme/host. A pasted profile URL or
// a leading '@' or '$' is reduced to the bare handle; anything else outside the
// per-method character set is rejected.
const PROFILE_URL = /^(?:https?:\/\/)?(?:www\.)?(venmo\.com|cash\.app|paypal\.me)\/(.*)$/i;

/** Reduces a pasted profile URL, a leading '@' or a leading '$' to the bare handle. */
const bareHandle = (raw: string): string => {
  let handle = raw.trim();
  const url = PROFILE_URL.exec(handle);
  if (url) {
    const segments = url[2]!.split(/[?#]/)[0]!.split('/').filter(Boolean);
    if (url[1]!.toLowerCase() === 'venmo.com' && segments[0]?.toLowerCase() === 'u') segments.shift();
    handle = segments[0] ?? '';
  }
  return handle.replace(/^[@$]+/, '');
};

const paymentHandle = (label: string, allowed: RegExp, rule: string) =>
  z
    .string()
    .max(256)
    .transform(bareHandle)
    .pipe(z.string().max(64).regex(allowed, `${label} can use only ${rule}.`))
    .optional();
export const paymentHandlesSchema = z
  .object({
    venmoHandle: paymentHandle('Venmo username', /^[A-Za-z0-9._-]*$/, 'letters, numbers, dots, dashes and underscores'),
    cashappCashtag: paymentHandle('Cash App $cashtag', /^[A-Za-z0-9]*$/, 'letters and numbers'),
    paypalHandle: paymentHandle('PayPal.me name', /^[A-Za-z0-9._-]*$/, 'letters, numbers, dots, dashes and underscores'),
  })
  .refine((v) => v.venmoHandle !== undefined || v.cashappCashtag !== undefined || v.paypalHandle !== undefined, {
    message: 'At least one payment handle is required',
  });

// Opt-in switch for the public /u/:username share page.
export const publicScheduleSchema = z.object({
  publicSchedule: z.boolean(),
});

export const accountDeleteSchema = z.object({
  // Optional: a provider-only account has no password and confirms with a recent re-auth.
  password: z.string().min(1, 'Password confirmation required').optional(),
  // Who takes over each crew the account owns. Optional: the server picks the
  // earliest-joined active member when a choice is missing or invalid.
  crewHandover: z.array(z.object({ crewId: identifier, newOwnerId: identifier })).max(50).optional(),
});

// A password, or a fresh token from a linked Google or Apple account.
export const reauthSchema = z.union([
  z.object({ password: z.string().min(1).max(200) }),
  z.object({ provider: providerName, idToken, nonce: oauthNonce, authorizationCode }),
]);

export const forgotPasswordSchema = z.object({
  email: z.string().email('Valid email required').max(254),
});

export const updateEmailSchema = z.object({
  email: z.string().email('Valid email required').max(254),
  // Optional: a provider-only account has no password and confirms with a recent re-auth.
  password: z.string().min(1, 'Password confirmation required').optional(),
});
