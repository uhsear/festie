// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import crypto from 'node:crypto';
import { Resend } from 'resend';
import { escapeHtml } from './helpers';
import { isSafeOrganizationName } from './schemas/organization';

let _resend: any = null;

function getClient(apiKey: any) {
  if (!_resend && apiKey) _resend = new Resend(apiKey);
  return _resend;
}

// P3.4: Idempotency guard — prevents duplicate sends on retry/double-click.
// Redis-first so the guard survives a restart and is shared across processes; the
// in-memory map is the fallback when no client is passed or Redis errors.
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _recentSends = new Map(); // key → timestamp

function _idempotencyKey(to: any, subject: any) {
  return `${to}:${subject}`;
}

// The recipient is PII: hash it before it becomes a Redis key.
function _redisDedupeKey(to: any, subject: any, config: any) {
  const digest = crypto.createHash('sha256').update(_idempotencyKey(to, subject)).digest('hex').slice(0, 32);
  return `${config.REDIS_PREFIX || 'fp:'}email:dedupe:${digest}`;
}

async function _checkIdempotency(to: any, subject: any, log: any, redis: any, config: any) {
  if (redis) {
    try {
      if ((await redis.exists(_redisDedupeKey(to, subject, config))) === 1) {
        log.warn('email:duplicate-suppressed', {});
        return true;
      }
      return false;
    } catch (error: any) {
      log.warn('email:dedupe-redis-failed', { error: error.message });
    }
  }
  const key = _idempotencyKey(to, subject);
  const lastSent = _recentSends.get(key);
  if (lastSent && Date.now() - lastSent < IDEMPOTENCY_TTL_MS) {
    log.warn('email:duplicate-suppressed', { lastSentMs: Date.now() - lastSent });
    return true; // duplicate
  }
  return false;
}

async function _recordSend(to: any, subject: any, log: any, redis: any, config: any) {
  if (redis) {
    try {
      await redis.set(_redisDedupeKey(to, subject, config), '1', 'PX', IDEMPOTENCY_TTL_MS);
      return;
    } catch (error: any) {
      log.warn('email:dedupe-redis-failed', { error: error.message });
    }
  }
  const key = _idempotencyKey(to, subject);
  _recentSends.set(key, Date.now());
  // Evict stale entries to prevent unbounded growth
  if (_recentSends.size > 500) {
    const now = Date.now();
    for (const [k, ts] of _recentSends) {
      if (now - ts > IDEMPOTENCY_TTL_MS) _recentSends.delete(k);
    }
  }
}

/**
 * Send a transactional email via Resend.
 * Gracefully degrades if RESEND_API_KEY is not set (logs a warning, or an error in production, and returns false).
 * Idempotent: suppresses duplicate sends to the same address+subject within 5
 * minutes, through Redis when `redis` is passed. Pass `dedupe: false` for mail that must never be silently dropped —
 * a security alert has a constant subject and a constant recipient, so the
 * guard would let an attacker suppress every alert after the first by simply
 * repeating the request. Opting out skips recording as well as checking, so an
 * exempt message neither suppresses nor is suppressed by anything else.
 */
export async function sendEmail({ to, subject, html, text, headers, idempotencyKey, config, log, _client, dedupe = true, type, redis }: any) {
  // Hard gate for non-transactional mail: no postal address or no one-click unsubscribe header, no send.
  if (MARKETING_EMAIL_TYPES.has(type) && (!_postalAddress(config) || !headers?.['List-Unsubscribe-Post'])) {
    log.debug?.('email:marketing-skip', { type, reason: 'postal address or unsubscribe link missing' });
    return false;
  }
  const apiKey = config.RESEND_API_KEY;
  if (!apiKey) {
    // A missing key in production means every user email is silently lost; surface it as an error.
    const level = config.NODE_ENV === 'production' ? 'error' : 'warn';
    log[level]('email:skip', { reason: 'RESEND_API_KEY not configured' });
    return false;
  }

  if (dedupe && (await _checkIdempotency(to, subject, log, redis, config))) return true;

  const client = _client || getClient(apiKey);
  const from = config.EMAIL_FROM || 'Festie <no-reply@festie.us>';

  try {
    // The key goes to Resend as the Idempotency-Key request header (SDK options), not as a mail header.
    const message = { from, to: [to], subject, html, text, ...(headers ? { headers } : {}) };
    const result = await client.emails.send(message, ...(idempotencyKey ? [{ idempotencyKey }] : []));
    if (result.error) {
      log.error('email:send-error', { error: result.error.message });
      return false;
    }
    if (dedupe) await _recordSend(to, subject, log, redis, config);
    // Only the provider id and the template name: the recipient, subject and body are PII.
    log.info('email:sent', { id: result.data?.id, type });
    return true;
  } catch (error: any) {
    log.error('email:send-failed', { error: error.message });
    return false;
  }
}

// `footer` is overridable because a security alert must not close with "you can
// safely ignore this email" directly under "change your password immediately".
function _wrapTemplate(title: any, bodyHtml: any, footer = "If you didn't request this, you can safely ignore this email.") {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:16px;overflow:hidden">
  <tr><td style="padding:32px 32px 24px;text-align:center">
    <h1 style="margin:0 0 4px;color:#e4e4e7;font-size:22px;font-weight:600">Festie</h1>
    <p style="margin:0;color:rgba(255,255,255,0.5);font-size:13px">${title}</p>
  </td></tr>
  <tr><td style="padding:0 32px 24px">${bodyHtml}</td></tr>
  <tr><td style="padding:20px 32px;border-top:1px solid rgba(255,255,255,0.06)">
    <p style="color:#a1a1aa;font-size:12px;line-height:1.5;margin:0">${footer}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function _buttonHtml(url: any, label: any) {
  return `<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#00e8d0;color:#0a0a0f;text-decoration:none;font-size:15px;font-weight:600;padding:14px 36px;border-radius:10px">${label}</a>
    </td></tr></table>`;
}

function _urlFallback(url: any) {
  return `<p style="color:#a1a1aa;font-size:13px;line-height:1.5;margin:24px 0 0">If the button doesn't work, copy and paste this URL into your browser:</p>
    <p style="color:#00e8d0;font-size:12px;line-height:1.5;word-break:break-all;margin:8px 0 0">${escapeHtml(url)}</p>`;
}

// The verify link lifetime is configurable, so the mail must not hard-code it.
function _hoursText(config: any) {
  const h = Number(config?.EMAIL_VERIFY_TOKEN_TTL_HOURS) || 24;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/**
 * Send password reset email.
 */
export async function sendPasswordResetEmail({ to, username, resetUrl, config, log, _client, redis }: any) {
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Your username is <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>.</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">We received a request to reset your password. Click the button below to choose a new one. This link expires in 60 minutes.</p>
    ${_buttonHtml(resetUrl, 'Reset Password')}
    ${_urlFallback(resetUrl)}`;

  const html = _wrapTemplate('Password Reset Request', bodyHtml);
  const text = `Hey ${username},\n\nYour username is ${username}.\n\nWe received a request to reset your Festie password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 60 minutes.\n\nIf you didn't request this, you can safely ignore this email.`;

  return sendEmail({ to, subject: 'Reset your Festie password', html, text, config, log, _client, type: 'password_reset', redis });
}

/** Link in a verification or email-change mail. It opens the web confirm page: a GET must never consume the token, because mail scanners prefetch links. */
export function verifyEmailUrl(config: { PUBLIC_ORIGIN: string }, token: string): string {
  return `${config.PUBLIC_ORIGIN}/verify-email?token=${token}`;
}

/**
 * Send email verification email.
 */
export async function sendVerificationEmail({ to, username, verifyUrl, config, log, _client, redis }: any) {
  const hours = _hoursText(config);
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">Thanks for signing up! Please verify your email address by clicking the button below. This link expires in ${hours}.</p>
    ${_buttonHtml(verifyUrl, 'Verify Email')}
    ${_urlFallback(verifyUrl)}`;

  const html = _wrapTemplate('Verify Your Email', bodyHtml);
  const text = `Hey ${username},\n\nThanks for signing up for Festie!\n\nVerify your email: ${verifyUrl}\n\nThis link expires in ${hours}.\n\nIf you didn't create this account, you can safely ignore this email.`;

  return sendEmail({ to, subject: 'Verify your Festie email', html, text, config, log, _client, type: 'verify_email', redis });
}

/**
 * Confirmation link sent to the proposed new address of an email change. A
 * signup verification mail ("Thanks for signing up!") reads wrong here.
 */
export async function sendEmailChangeConfirmEmail({ to, username, verifyUrl, config, log, _client }: any) {
  const hours = _hoursText(config);
  const intro = `You asked to use this address for your Festie account. Your login email changes when you confirm. This link expires in ${hours}.`;
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">${intro}</p>
    ${_buttonHtml(verifyUrl, 'Confirm new email')}
    ${_urlFallback(verifyUrl)}`;
  const footer = 'If you did not ask for this, ignore this email. Your account email stays the same.';
  const html = _wrapTemplate('Confirm New Email', bodyHtml, footer);
  const text = `Hey ${username},\n\n${intro}\n\nConfirm your new email: ${verifyUrl}\n\n${footer}`;
  return sendEmail({ to, subject: 'Confirm your new Festie email', html, text, config, log, _client, type: 'email_change_confirm' });
}

const SECURITY_FOOTER = 'Festie will never ask you for your password by email.';
const ALERT_P = 'color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px';

/**
 * Security alert to the address on file when an email change is requested.
 * It deliberately does NOT name the proposed new address: the point is to alert
 * the account owner, not to hand an attacker who already controls the session
 * anything extra. `dedupe: false` is load-bearing — recipient and subject are
 * both constant, so the idempotency guard would deliver one alert while an
 * attacker minted links all day.
 *
 * `resetUrl` is a single-use password-reset link, passed only when the address
 * on file is verified. A reset cancels the pending change and signs out every
 * device, so "This wasn't me" is one click.
 */
export async function sendEmailChangeNoticeEmail({ to, resetUrl, config, log, _client }: any) {
  const lines = [
    'Someone requested a change to the email address on your Festie account.',
    'The change does not take effect until the new address is confirmed, so your account is still reachable at this address for now.',
    resetUrl
      ? 'If this was not you, tap the button below to set a new password. That cancels the change and signs out every device.'
      : 'If this was not you, change your password immediately - your session may be compromised. Changing it cancels the pending change and signs every device out.',
  ];
  let bodyHtml = lines.map((line) => `<p style="${ALERT_P}">${escapeHtml(line)}</p>`).join('\n    ');
  let text = lines.join('\n\n');
  if (resetUrl) {
    bodyHtml += `\n    ${_buttonHtml(resetUrl, "This wasn't me")}\n    ${_urlFallback(resetUrl)}`;
    text += `\n\nThis wasn't me: ${resetUrl}`;
  }
  const html = _wrapTemplate('Security Alert', bodyHtml, SECURITY_FOOTER);
  return sendEmail({
    to,
    subject: 'Security alert: Festie email change requested',
    html,
    text,
    config,
    log,
    _client,
    type: 'email_change_notice',
    dedupe: false,
  });
}

/**
 * Sent to the old address once an email change is confirmed. Like the notice,
 * it does not name the new address, and it must never be deduplicated away.
 */
export async function sendEmailChangedEmail({ to, config, log, _client }: any) {
  const lines = [
    'The email address on your Festie account was changed.',
    'Every device was signed out. Sign in with the new address from now on.',
    'If this was not you, write to support@festie.us right away.',
  ];
  const bodyHtml = lines.map((line) => `<p style="${ALERT_P}">${escapeHtml(line)}</p>`).join('\n    ');
  const html = _wrapTemplate('Security Alert', bodyHtml, SECURITY_FOOTER);
  return sendEmail({
    to,
    subject: 'Your Festie email was changed',
    html,
    text: lines.join('\n\n'),
    config,
    log,
    _client,
    type: 'email_changed',
    dedupe: false,
  });
}

/**
 * The decision on an organizer's publish request, sent to the organization's owners. The text is fixed: only
 * the organization name, the festival name and the admin's note are filled in, and each is escaped.
 */
export async function sendPublishDecisionEmail({ to, organizationName, festivalName, decision, note, config, log, _client }: any) {
  const approved = decision === 'approved';
  const lines = approved
    ? [
        `Festie reviewed ${festivalName} for ${organizationName}, and it is live.`,
        'Attendees can find it now. Open your festivals to copy the public link.',
      ]
    : [
        `Festie asked for changes to ${festivalName} before it goes live.`,
        `Festie asked for changes: ${note}.`,
        'Edit your festival, then submit it again.',
      ];
  const bodyHtml = `${lines.map((line) => `<p style="${ALERT_P}">${escapeHtml(line)}</p>`).join('\n    ')}
    ${_buttonHtml(`${_origin(config)}/manage`, 'Open your festivals')}`;
  const footer = `You get this email because you are an owner of ${escapeHtml(organizationName)} on Festie.`;
  const subjectName = String(festivalName).replace(/[\r\n]+/g, ' ');
  return sendEmail({
    to,
    subject: approved ? `${subjectName} is live on Festie` : `Festie asked for changes to ${subjectName}`,
    html: _wrapTemplate(approved ? 'Festival live' : 'Changes requested', bodyHtml, footer),
    text: `${lines.join('\n\n')}\n\nOpen your festivals: ${_origin(config)}/manage\n\nYou get this email because you are an owner of ${organizationName} on Festie.`,
    config,
    log,
    _client,
    type: approved ? 'publish_approved' : 'publish_declined',
    dedupe: false,
  });
}

/**
 * Tells a person that an organization added them. The text is fixed: only the organization name and the role are
 * filled in, and the name is escaped. It carries nothing the person who added them typed (plan-v3 5.7). A name that
 * is not a plain name (a row from before the rule, or a link) is replaced by fixed words, so this mail never
 * carries a link to an address that may have no account.
 */
export async function sendOrganizationMemberEmail({ to, organizationName: storedName, role, config, log, _client }: any) {
  const organizationName = isSafeOrganizationName(String(storedName ?? '')) ? storedName : 'a team';
  const lines = [
    `You were added to ${organizationName} on Festie as ${role === 'viewer' ? 'a viewer' : `an ${role}`}.`,
    'Sign in with this email address, or create an account with it and confirm it. Then open Manage to see the festivals of your team.',
    'Manage your festival at festie.us/manage on a laptop or phone browser.',
  ];
  const url = `${_origin(config)}/manage`;
  const bodyHtml = `${lines.map((line) => `<p style="${ALERT_P}">${escapeHtml(line)}</p>`).join('\n    ')}
    ${_buttonHtml(url, 'Open Manage')}`;
  const footer = `You get this email because ${escapeHtml(organizationName)} added this address on Festie. If this is a mistake, ignore it.`;
  return sendEmail({
    to,
    subject: `You were added to ${String(organizationName).replace(/[\r\n]+/g, ' ')} on Festie`,
    html: _wrapTemplate('Added to a team', bodyHtml, footer),
    text: `${lines.join('\n\n')}\n\nOpen Manage: ${url}\n\nYou get this email because ${organizationName} added this address on Festie. If this is a mistake, ignore it.`,
    config,
    log,
    _client,
    type: 'organization_member_added',
    dedupe: false,
  });
}

// ── M3 re-engagement emails ─────────────────────────────────────────────
// All of these follow the _wrapTemplate + _buttonHtml pattern and deep-link to the
// relevant surface. They degrade gracefully when RESEND_API_KEY is unset
// (sendEmail logs a warning and returns false). Origin defaults to festie.us.

function _origin(config: any) {
  return (config?.PUBLIC_ORIGIN || 'https://festie.us').replace(/\/+$/, '');
}

// Non-transactional ("re-engagement", CAN-SPAM commercial) mail. sendEmail refuses these types unless
// EMAIL_POSTAL_ADDRESS is set and the message carries the RFC 8058 one-click unsubscribe headers.
// Transactional mail (password reset, verification, account alerts, the policy notice) is not listed.
export const MARKETING_EMAIL_TYPES = new Set(['wrap_ready', 'lineup_drop', 'days_out', 'set_times_out', 'crew_reformed']);

function _postalAddress(config: any): string {
  return typeof config?.EMAIL_POSTAL_ADDRESS === 'string' ? config.EMAIL_POSTAL_ADDRESS.trim() : '';
}

/** The key that signs unsubscribe links: EMAIL_UNSUBSCRIBE_SECRET, else SESSION_SECRET. */
export function unsubscribeSecret(config: any): string {
  return config?.EMAIL_UNSUBSCRIBE_SECRET || config?.SESSION_SECRET || '';
}

function _unsubscribeSignature(userId: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`email-unsubscribe:${userId}`).digest('base64url');
}

/** Signed per-user unsubscribe token: `<userId>.<HMAC-SHA256>`. It never expires; an unsubscribe is safe to replay. */
export function unsubscribeToken(userId: string, secret: string): string {
  return `${userId}.${_unsubscribeSignature(userId, secret)}`;
}

/** The user id inside a valid unsubscribe token, or null for a malformed or forged one. */
export function verifyUnsubscribeToken(token: unknown, secret: string): string | null {
  if (!secret || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const userId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(_unsubscribeSignature(userId, secret));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? userId : null;
}

// Everything a marketing message needs: the unsubscribe URL, the RFC 8058 headers and the postal address.
// null (and no send) when any of them cannot be provided: no address, no signing secret or no user id.
function _marketingPrep(type: string, userId: any, config: any, log: any) {
  const address = _postalAddress(config);
  const secret = unsubscribeSecret(config);
  if (!address || !secret || !userId) {
    log?.debug?.('email:marketing-skip', { type, reason: 'postal address, signing secret or user id missing' });
    return null;
  }
  const url = `${_origin(config)}/api/v1/auth/unsubscribe?token=${encodeURIComponent(unsubscribeToken(String(userId), secret))}`;
  const headers = { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
  return { url, address, headers };
}

// Footer + plain-text line naming the notification setting that gates this email, a one-click
// unsubscribe link and the CAN-SPAM postal address (from config because the repo is public).
function _reengagementFooter(label: string, config: any, prep: { url: string; address: string }) {
  const settings = `${_origin(config)}/account`;
  return {
    html: `You get this email because "${label}" is on in your Festie notification settings. <a href="${prep.url}" style="color:rgba(255,255,255,0.5)">Unsubscribe</a> in one click, or change your <a href="${settings}" style="color:rgba(255,255,255,0.5)">notification settings</a>.<br>${escapeHtml(prep.address)}`,
    text: `You get this email because "${label}" is on in your Festie notification settings. Unsubscribe in one click: ${prep.url}
Notification settings: ${settings}
${prep.address}`,
  };
}

/**
 * "Your wrap-up is ready" — deep-links to /wrap for the finished festival.
 */
export async function sendWrapReadyEmail({ to, userId, username, festivalName, festivalId, config, log, _client }: any) {
  const prep = _marketingPrep('wrap_ready', userId, config, log);
  if (!prep) return false;
  const origin = _origin(config);
  const wrapUrl = `${origin}/wrap${festivalId ? `?festival=${encodeURIComponent(festivalId)}` : ''}`;
  const name = festivalName || 'your festival';
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">${escapeHtml(name)} wrapped up. Your recap is ready: top sets, crew superlatives, and your numbers.</p>
    ${_buttonHtml(wrapUrl, 'See your wrap-up')}
    ${_urlFallback(wrapUrl)}`;
  const footer = _reengagementFooter('Wrap-up ready', config, prep);
  const html = _wrapTemplate('Your Festival Wrap-Up', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\n${name} wrapped up. Your recap is ready.\n\nSee your wrap-up: ${wrapUrl}\n\n${footer.text}`;
  return sendEmail({ to, subject: `Your ${name} wrap-up is ready`, html, text, headers: prep.headers, config, log, _client, type: 'wrap_ready' });
}

/**
 * "The lineup just dropped" — deep-links to the festival page.
 */
export async function sendLineupDropEmail({ to, userId, username, festivalName, festivalId, hasTimes = true, config, log, _client }: any) {
  const prep = _marketingPrep('lineup_drop', userId, config, log);
  if (!prep) return false;
  const origin = _origin(config);
  const festivalUrl = `${origin}/?festival=${encodeURIComponent(festivalId || '')}`;
  const name = festivalName || 'a festival you love';
  // With no timed set there is nothing to pick yet, so the mail only promises a later alert.
  const sentence = hasTimes
    ? 'is out. Start picking your sets before tickets move.'
    : "is out. See who is playing. We'll tell you when set times are out.";
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">The lineup for <strong style="color:#e4e4e7">${escapeHtml(name)}</strong> ${escapeHtml(sentence)}</p>
    ${_buttonHtml(festivalUrl, 'See the lineup')}
    ${_urlFallback(festivalUrl)}`;
  const footer = _reengagementFooter('New lineups', config, prep);
  const html = _wrapTemplate('New Lineup', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\nThe lineup for ${name} ${hasTimes ? 'just dropped.' : sentence}\n\nSee the lineup: ${festivalUrl}\n\n${footer.text}`;
  const subject = hasTimes ? `${name} lineup just dropped` : `${name} lineup is out`;
  return sendEmail({ to, subject, html, text, headers: prep.headers, config, log, _client, type: 'lineup_drop' });
}

/**
 * "{Festival} days are out" — sent from the admin "Announce days" action, before any set has a time.
 */
export async function sendDaysOutEmail({ to, userId, username, festivalName, festivalId, config, log, _client }: any) {
  const prep = _marketingPrep('days_out', userId, config, log);
  if (!prep) return false;
  const origin = _origin(config);
  const festivalUrl = `${origin}/?festival=${encodeURIComponent(festivalId || '')}`;
  const name = festivalName || 'Your festival';
  const sentence = 'See who plays which day. Set times come later.';
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">The days for <strong style="color:#e4e4e7">${escapeHtml(name)}</strong> are out. ${sentence}</p>
    ${_buttonHtml(festivalUrl, 'See the lineup')}
    ${_urlFallback(festivalUrl)}`;
  const footer = _reengagementFooter('New lineups, days and set times', config, prep);
  const html = _wrapTemplate('Days Are Out', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\nThe days for ${name} are out. ${sentence}\n\nSee the lineup: ${festivalUrl}\n\n${footer.text}`;
  return sendEmail({ to, subject: `${name} days are out`, html, text, headers: prep.headers, config, log, _client, type: 'days_out' });
}

/** "Friday", "Friday and Saturday", "Fri, Sat and Sun". The set-times push and email share it. */
export function joinDayLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * "{Festival} set times are out" — deep-links to the festival page. `dayLabels` names the released days
 * ("Friday and Saturday"); without them the mail says "the set times". `note` is the admin's own line.
 */
export async function sendSetTimesOutEmail({ to, userId, username, festivalName, festivalId, dayLabels = [], note, config, log, _client }: any) {
  const prep = _marketingPrep('set_times_out', userId, config, log);
  if (!prep) return false;
  const origin = _origin(config);
  const festivalUrl = `${origin}/?festival=${encodeURIComponent(festivalId || '')}`;
  const name = festivalName || 'Your festival';
  const days = joinDayLabels(dayLabels);
  const the = days ? `The ${days} set times` : 'The set times';
  const noteHtml = note ? `<p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">${escapeHtml(note)}</p>` : '';
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">${escapeHtml(the)} for <strong style="color:#e4e4e7">${escapeHtml(name)}</strong> are out. Pick your sets and spot clashes before the weekend.</p>
    ${noteHtml}
    ${_buttonHtml(festivalUrl, 'See the schedule')}
    ${_urlFallback(festivalUrl)}`;
  const footer = _reengagementFooter('New lineups and set times', config, prep);
  const html = _wrapTemplate('Set Times Are Out', bodyHtml, footer.html);
  const noteText = note ? `\n\n${note}` : '';
  const text = `Hey ${username || 'there'},\n\n${the} for ${name} are out. Pick your sets and spot clashes before the weekend.${noteText}\n\nSee the schedule: ${festivalUrl}\n\n${footer.text}`;
  const subject = days ? `${name}: ${days} set times are out` : `${name} set times are out`;
  return sendEmail({ to, subject, html, text, headers: prep.headers, config, log, _client, type: 'set_times_out' });
}

/**
 * "Your crew reformed for the next one" — deep-links to the new crew.
 */
export async function sendCrewReformEmail({
  to,
  userId,
  username,
  crewName,
  festivalName,
  crewId,
  inviteUrl,
  config,
  log,
  _client,
}: any) {
  const prep = _marketingPrep('crew_reformed', userId, config, log);
  if (!prep) return false;
  const origin = _origin(config);
  // Prefer an explicit invite link (the invitee may not have a festival profile
  // yet); otherwise deep-link to the crew page.
  const url = inviteUrl || `${origin}/crew/${encodeURIComponent(crewId || '')}`;
  const crew = crewName || 'Your crew';
  const fest = festivalName ? ` for ${festivalName}` : '';
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px"><strong style="color:#e4e4e7">${escapeHtml(crew)}</strong> is getting back together${escapeHtml(fest)}. Jump in to plan picks, meeting points, and logistics with the crew.</p>
    ${_buttonHtml(url, 'Join the crew')}
    ${_urlFallback(url)}`;
  const footer = _reengagementFooter('Crew re-forms', config, prep);
  const html = _wrapTemplate('Your Crew Reformed', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\n${crew} is getting back together${fest}.\n\nJoin the crew: ${url}\n\n${footer.text}`;
  return sendEmail({ to, subject: `${crew} reformed${fest}`, html, text, headers: prep.headers, config, log, _client, type: 'crew_reformed' });
}

const POLICY_NOTICE_LINE = 'This is a service notice about changes to the Festie Privacy Policy and Terms. We send it to every account.';

/**
 * Policy-update notice. Transactional legal mail, so the caller sends it regardless of the
 * marketing and re-engagement opt-outs, and it carries no List-Unsubscribe header.
 * `html` is the admin's own markup; without it the body is the escaped text, one paragraph per blank line.
 * dedupe is off: the policy_notice_sends ledger is the idempotency guard, and the 5-minute
 * address+subject guard would report a suppressed send as delivered.
 */
export async function sendPolicyNoticeEmail({ to, subject, text, html, idempotencyKey, config, log, _client }: any) {
  const bodyHtml =
    html ??
    text
      .split(/\n{2,}/)
      .map((p: string) => `<p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
      .join('');
  return sendEmail({
    to,
    subject,
    html: _wrapTemplate('Policy update', bodyHtml, POLICY_NOTICE_LINE),
    text: `${text}\n\n${POLICY_NOTICE_LINE}`,
    idempotencyKey,
    config,
    log,
    _client,
    dedupe: false,
    type: 'policy_notice',
  });
}
