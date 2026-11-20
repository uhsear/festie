// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { z } from 'zod';
import { password, username } from './primitives';

// ════════════════════════════════════════════════════════════════════════════════
// Authentication Schemas
// ════════════════════════════════════════════════════════════════════════════════
// Password resets need an address, so sign-up requires one (FND-023).
const requiredEmail = z.string().trim().min(1, 'Email is required').email('Invalid email address').max(254);

/** True if `iso` (YYYY-MM-DD) is a date at least `years` years before today. */
function isAtLeastYearsOld(iso: string, years: number): boolean {
  const dob = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const threshold = new Date(Date.UTC(dob.getUTCFullYear() + years, dob.getUTCMonth(), dob.getUTCDate()));
  return threshold.getTime() <= Date.now();
}

// Anonymous sign-up source from a ?ref= link. Lower-cased; anything that does
// not match the pattern is dropped rather than failing the sign-up.
const SIGNUP_REF_PATTERN = /^[a-z0-9_-]{1,40}$/;
const signupRef = z.string().trim().toLowerCase().regex(SIGNUP_REF_PATTERN).optional().catch(undefined);

const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter your date of birth')
  .refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date of birth');
const tosAccepted = z.literal(true, { error: 'You must accept the Terms of Service' });
const adultRule = {
  message: 'You must be at least 18 to use Festie',
  path: ['dateOfBirth'],
};

export const registerSchema = z
  .object({
    username,
    password,
    confirmPassword: z.string(),
    email: requiredEmail,
    dateOfBirth,
    tosAccepted,
    ref: signupRef,
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => isAtLeastYearsOld(d.dateOfBirth, 18), adultRule);

// ── Sign in with Google and Apple (T45) ──
export const providerName = z.enum(['google', 'apple']);
export const idToken = z.string().min(20).max(4096);
export const oauthNonce = z.string().min(16).max(128).optional();
export const authorizationCode = z.string().max(512).optional(); // Apple only

export const oauthProviderParams = z.object({ provider: providerName });

export const oauthSignInSchema = z.object({
  idToken,
  nonce: oauthNonce,
  authorizationCode,
  redirectUri: z.string().url().max(300).optional(), // Apple web code exchange
  // Apple sends the name once, so markup is stripped in the route instead of rejected here.
  name: z
    .object({
      givenName: z.string().max(50).optional(),
      familyName: z.string().max(50).optional(),
    })
    .optional(),
});

// /register minus the password: the provider is the sign-in method.
export const oauthCompleteSchema = z
  .object({
    signupToken: z.string().min(20).max(128),
    username,
    dateOfBirth,
    tosAccepted,
    ref: signupRef,
  })
  .refine((d) => isAtLeastYearsOld(d.dateOfBirth, 18), adultRule);

export const setPasswordSchema = z
  .object({ newPassword: password, confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username or email required').max(254),
  password: z.string().min(1, 'Password required').max(200),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password required'),
    newPassword: password,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
