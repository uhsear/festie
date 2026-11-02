// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { Resend } from 'resend';
import { escapeHtml } from './helpers';

let _resend: any = null;

function getClient(apiKey: any) {
  if (!_resend && apiKey) _resend = new Resend(apiKey);
  return _resend;
}

// P3.4: Idempotency guard — prevents duplicate sends on retry/double-click
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes
const _recentSends = new Map(); // key → timestamp

function _idempotencyKey(to: any, subject: any) {
  return `${to}:${subject}`;
}

function _checkIdempotency(to: any, subject: any, log: any) {
  const key = _idempotencyKey(to, subject);
  const lastSent = _recentSends.get(key);
  if (lastSent && Date.now() - lastSent < IDEMPOTENCY_TTL_MS) {
    log.warn('email:duplicate-suppressed', { to, subject, lastSentMs: Date.now() - lastSent });
    return true; // duplicate
  }
  return false;
}

function _recordSend(to: any, subject: any) {
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
 * Gracefully degrades if RESEND_API_KEY is not set (logs warning, returns false).
 * Idempotent: suppresses duplicate sends to the same address+subject within 5
 * minutes. Pass `dedupe: false` for mail that must never be silently dropped —
 * a security alert has a constant subject and a constant recipient, so the
 * guard would let an attacker suppress every alert after the first by simply
 * repeating the request. Opting out skips recording as well as checking, so an
 * exempt message neither suppresses nor is suppressed by anything else.
 */
export async function sendEmail({ to, subject, html, text, headers, config, log, _client, dedupe = true }: any) {
  const apiKey = config.RESEND_API_KEY;
  if (!apiKey) {
    log.warn('email:skip', { to, subject, reason: 'RESEND_API_KEY not configured' });
    return false;
  }

  if (dedupe && _checkIdempotency(to, subject, log)) return true;

  const client = _client || getClient(apiKey);
  const from = config.EMAIL_FROM || 'Festie <no-reply@festie.us>';

  try {
    const result = await client.emails.send({ from, to: [to], subject, html, text, ...(headers ? { headers } : {}) });
    if (result.error) {
      log.error('email:send-error', { to, subject, error: result.error.message });
      return false;
    }
    if (dedupe) _recordSend(to, subject);
    log.debug('email:sent', { to, subject, id: result.data?.id });
    return true;
  } catch (error: any) {
    log.error('email:send-failed', { to, subject, error: error.message });
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
export async function sendPasswordResetEmail({ to, username, resetUrl, config, log, _client }: any) {
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Your username is <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>.</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">We received a request to reset your password. Click the button below to choose a new one. This link expires in 60 minutes.</p>
    ${_buttonHtml(resetUrl, 'Reset Password')}
    ${_urlFallback(resetUrl)}`;

  const html = _wrapTemplate('Password Reset Request', bodyHtml);
  const text = `Hey ${username},\n\nYour username is ${username}.\n\nWe received a request to reset your Festie password.\n\nReset your password: ${resetUrl}\n\nThis link expires in 60 minutes.\n\nIf you didn't request this, you can safely ignore this email.`;

  return sendEmail({ to, subject: 'Reset your Festie password', html, text, config, log, _client });
}

/**
 * Send email verification email.
 */
export async function sendVerificationEmail({ to, username, verifyUrl, config, log, _client }: any) {
  const hours = _hoursText(config);
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username)}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">Thanks for signing up! Please verify your email address by clicking the button below. This link expires in ${hours}.</p>
    ${_buttonHtml(verifyUrl, 'Verify Email')}
    ${_urlFallback(verifyUrl)}`;

  const html = _wrapTemplate('Verify Your Email', bodyHtml);
  const text = `Hey ${username},\n\nThanks for signing up for Festie!\n\nVerify your email: ${verifyUrl}\n\nThis link expires in ${hours}.\n\nIf you didn't create this account, you can safely ignore this email.`;

  return sendEmail({ to, subject: 'Verify your Festie email', html, text, config, log, _client });
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
  return sendEmail({ to, subject: 'Confirm your new Festie email', html, text, config, log, _client });
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
    dedupe: false,
  });
}

// ── M3 re-engagement emails ─────────────────────────────────────────────
// All three follow the _wrapTemplate + _buttonHtml pattern and deep-link to the
// relevant surface. They degrade gracefully when RESEND_API_KEY is unset
// (sendEmail logs a warning and returns false). Origin defaults to festie.us.

function _origin(config: any) {
  return (config?.PUBLIC_ORIGIN || 'https://festie.us').replace(/\/+$/, '');
}

// CAN-SPAM / RFC 8058: re-engagement (marketing) mail carries an unsubscribe
// affordance via the List-Unsubscribe header. Transactional mail (password
// reset, email verification) is exempt and does NOT set this. The server-side
// opt-out + DND checks in lib/notifications/reengagement.ts are the enforcement
// layer; this header is the inbox-client one-tap surface.
function reengagementHeaders(config: any) {
  return { 'List-Unsubscribe': `<${_origin(config)}/account>` };
}

// Footer + plain-text line naming the notification setting that gates this email.
function _reengagementFooter(label: string, config: any) {
  const url = `${_origin(config)}/account`;
  return {
    html: `You get this email because "${label}" is on in your Festie notification settings. <a href="${url}" style="color:rgba(255,255,255,0.5)">Turn it off</a>.`,
    text: `You get this email because "${label}" is on in your Festie notification settings. Turn it off: ${url}`,
  };
}

/**
 * "Your wrap-up is ready" — deep-links to /wrap for the finished festival.
 */
export async function sendWrapReadyEmail({ to, username, festivalName, festivalId, config, log, _client }: any) {
  const origin = _origin(config);
  const wrapUrl = `${origin}/wrap${festivalId ? `?festival=${encodeURIComponent(festivalId)}` : ''}`;
  const name = festivalName || 'your festival';
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">${escapeHtml(name)} wrapped up. Your recap is ready: top sets, crew superlatives, and your numbers.</p>
    ${_buttonHtml(wrapUrl, 'See your wrap-up')}
    ${_urlFallback(wrapUrl)}`;
  const footer = _reengagementFooter('Wrap-up ready', config);
  const html = _wrapTemplate('Your Festival Wrap-Up', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\n${name} wrapped up. Your recap is ready.\n\nSee your wrap-up: ${wrapUrl}\n\n${footer.text}`;
  return sendEmail({ to, subject: `Your ${name} wrap-up is ready`, html, text, headers: reengagementHeaders(config), config, log, _client });
}

/**
 * "The lineup just dropped" — deep-links to the festival page.
 */
export async function sendLineupDropEmail({ to, username, festivalName, festivalId, config, log, _client }: any) {
  const origin = _origin(config);
  const festivalUrl = `${origin}/?festival=${encodeURIComponent(festivalId || '')}`;
  const name = festivalName || 'a festival you love';
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">The lineup for <strong style="color:#e4e4e7">${escapeHtml(name)}</strong> is out. Start picking your sets before tickets move.</p>
    ${_buttonHtml(festivalUrl, 'See the lineup')}
    ${_urlFallback(festivalUrl)}`;
  const footer = _reengagementFooter('New lineups', config);
  const html = _wrapTemplate('New Lineup', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\nThe lineup for ${name} just dropped.\n\nSee the lineup: ${festivalUrl}\n\n${footer.text}`;
  return sendEmail({ to, subject: `${name} lineup just dropped`, html, text, headers: reengagementHeaders(config), config, log, _client });
}

/**
 * "{Festival} set times are out" — deep-links to the festival page.
 */
export async function sendSetTimesOutEmail({ to, username, festivalName, festivalId, config, log, _client }: any) {
  const origin = _origin(config);
  const festivalUrl = `${origin}/?festival=${encodeURIComponent(festivalId || '')}`;
  const name = festivalName || 'Your festival';
  const bodyHtml = `
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 16px">Hey <strong style="color:#e4e4e7">${escapeHtml(username || 'there')}</strong>,</p>
    <p style="color:#d4d4d8;font-size:15px;line-height:1.6;margin:0 0 24px">The set times for <strong style="color:#e4e4e7">${escapeHtml(name)}</strong> are out. Pick your sets and spot clashes before the weekend.</p>
    ${_buttonHtml(festivalUrl, 'See the schedule')}
    ${_urlFallback(festivalUrl)}`;
  const footer = _reengagementFooter('New lineups and set times', config);
  const html = _wrapTemplate('Set Times Are Out', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\nThe set times for ${name} are out. Pick your sets and spot clashes before the weekend.\n\nSee the schedule: ${festivalUrl}\n\n${footer.text}`;
  return sendEmail({ to, subject: `${name} set times are out`, html, text, headers: reengagementHeaders(config), config, log, _client });
}

/**
 * "Your crew reformed for the next one" — deep-links to the new crew.
 */
export async function sendCrewReformEmail({
  to,
  username,
  crewName,
  festivalName,
  crewId,
  inviteUrl,
  config,
  log,
  _client,
}: any) {
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
  const footer = _reengagementFooter('Crew re-forms', config);
  const html = _wrapTemplate('Your Crew Reformed', bodyHtml, footer.html);
  const text = `Hey ${username || 'there'},\n\n${crew} is getting back together${fest}.\n\nJoin the crew: ${url}\n\n${footer.text}`;
  return sendEmail({ to, subject: `${crew} reformed${fest}`, html, text, headers: reengagementHeaders(config), config, log, _client });
}
