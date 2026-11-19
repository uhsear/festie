// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import type { Response } from 'express';
import type { AppConfig } from './config.js';

export const ErrorCodes = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_FIELD: 'MISSING_FIELD',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  MAX_LIMIT_REACHED: 'MAX_LIMIT_REACHED',
  VERSION_MISMATCH: 'VERSION_MISMATCH',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // Spotify answered 429 to an admin search or pick.
  SPOTIFY_RATE_LIMITED: 'SPOTIFY_RATE_LIMITED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  REAUTH_REQUIRED: 'REAUTH_REQUIRED',
  CONFIRM_REMOVALS: 'CONFIRM_REMOVALS',
  FESTIVAL_CHANGED: 'FESTIVAL_CHANGED',
  // The backfill plan differs from the dry-run report the caller reviewed.
  PLAN_CHANGED: 'PLAN_CHANGED',
  // An artist edit that clashes with another artist, or that started from an out-of-date copy.
  ARTIST_EXISTS: 'ARTIST_EXISTS',
  ARTIST_CHANGED: 'ARTIST_CHANGED',
  PUBLISH_BLOCKED: 'PUBLISH_BLOCKED',
  // Per-date set-time release (routes/time-releases.ts).
  DRAFT: 'DRAFT',
  FESTIVAL_OVER: 'FESTIVAL_OVER',
  PARTIAL_RELEASE: 'PARTIAL_RELEASE',
  ALREADY_RELEASED: 'ALREADY_RELEASED',
  // Sign in with Google and Apple (T45)
  PROVIDER_NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  PROVIDER_TOKEN_INVALID: 'PROVIDER_TOKEN_INVALID',
  IDENTITY_EMAIL_IN_USE: 'IDENTITY_EMAIL_IN_USE',
  IDENTITY_LINKED_ELSEWHERE: 'IDENTITY_LINKED_ELSEWHERE',
  IDENTITY_NOT_LINKED: 'IDENTITY_NOT_LINKED',
  PROVIDER_ALREADY_LINKED: 'PROVIDER_ALREADY_LINKED',
  LAST_SIGN_IN_METHOD: 'LAST_SIGN_IN_METHOD',
  SIGNUP_EXPIRED: 'SIGNUP_EXPIRED',
  PASSWORD_ALREADY_SET: 'PASSWORD_ALREADY_SET',
  // T54: an invite join or preview of a crew whose owner locked it. 403, not 423 (423 is account lockout).
  CREW_LOCKED: 'CREW_LOCKED',
} as const;

// Errors that are safe to retry (transient failures)
export const RETRYABLE_CODES: Set<string> = new Set([
  ErrorCodes.RATE_LIMITED,
  ErrorCodes.INTERNAL_ERROR,
  ErrorCodes.SERVICE_UNAVAILABLE,
  ErrorCodes.SPOTIFY_RATE_LIMITED,
  ErrorCodes.VERSION_MISMATCH,
]);

// Envelope rule: every JSON API route answers through sendSuccess and sendError.
// A route may bypass the envelope only when a non-API client fixes the body format:
// a platform file (apple-app-site-association, assetlinks.json), Prometheus text,
// an iCalendar feed, or an HTML or image page. Such a route sends its own
// Content-Type. Say so in a comment at the bypass, and say how its errors are sent.
export function sendSuccess<T = unknown>(
  res: Response,
  data: T,
  meta: Record<string, any> | null = null,
  config: AppConfig | null = null,
) {
  const body: Record<string, any> = { data, error: null };
  if (meta && Object.keys(meta).length > 0) {
    body.meta = meta;
  }
  if (config?.API_VERSION) {
    res.setHeader('X-API-Version', config.API_VERSION);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(body);
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  code: string | null = null,
  details: Record<string, any> | null = null,
) {
  const error: Record<string, any> = { message, status };
  if (code) {
    error.code = code;
    error.retryable = RETRYABLE_CODES.has(code);
  } else {
    error.retryable = status >= 500;
  }
  if (details && Object.keys(details).length > 0) Object.assign(error, details);
  // Read by the request log line, which otherwise records a bare status.
  if (res.locals) res.locals.errorInfo = { code: code ?? undefined, message };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(status).json({ data: null, error });
}
