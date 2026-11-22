/**
 * The decision email on an organizer's publish request (lib/email.ts sendPublishDecisionEmail, routes/festivals.ts).
 * Mocked deps, no database. One email per owner and per decision: a decline, and an admin publish that answers a
 * waiting request. A publish with no request, and a verified organization's own publish, send none.
 */

import assert from 'node:assert/strict';
import { describe, mock, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createFestivalsRoutes from '../routes/festivals.js';
import { sendPublishDecisionEmail } from '../lib/email.js';

const pass = () => (req: any, _res: any, next: any) => {
  req.validatedBody = req.body;
  req.validatedParams = req.params;
  next();
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('sendPublishDecisionEmail', () => {
  const run = async (args: object) => {
    const send = mock.fn(async (_message: any) => ({ data: { id: 'm1' }, error: null }));
    const ok = await sendPublishDecisionEmail({
      to: 'owner@example.com',
      organizationName: 'Venue <b>X</b>',
      festivalName: 'Fest\nSubject',
      config: { RESEND_API_KEY: 'key', PUBLIC_ORIGIN: 'https://festie.example' },
      log: { info() {}, warn() {}, error() {} },
      _client: { emails: { send } },
      ...args,
    });
    return { ok, message: send.mock.calls[0]?.arguments[0] as any };
  };

  test('a decline carries the note, escapes every filled-in name, and links to /manage', async () => {
    const { ok, message } = await run({ decision: 'declined', note: 'Add the <venue> address' });
    assert.equal(ok, true);
    assert.deepEqual(message.to, ['owner@example.com']);
    assert.equal(message.subject, 'Festie asked for changes to Fest Subject');
    assert.match(message.text, /Note from Festie: Add the <venue> address\./);
    assert.match(message.html, /Add the &lt;venue&gt; address/);
    assert.match(message.html, /Venue &lt;b&gt;X&lt;\/b&gt;/);
    assert.doesNotMatch(message.html, /<venue>|<b>X<\/b>/);
    assert.match(message.html, /https:\/\/festie\.example\/manage/);
    assert.equal(message.headers, undefined, 'a decision is not marketing mail: no unsubscribe header');
  });

  test('a note that ends in a question mark or exclamation mark gets no extra period', async () => {
    const q = await run({ decision: 'declined', note: 'Is the map right?' });
    assert.match(q.message.text, /Note from Festie: Is the map right\?\r?\n/);
    const e = await run({ decision: 'declined', note: 'Fix the dates!' });
    assert.match(e.message.text, /Note from Festie: Fix the dates!\r?\n/);
  });

  test('an approval says the festival is live and has no note', async () => {
    const { message } = await run({ decision: 'approved' });
    assert.equal(message.subject, 'Fest Subject is live on Festie');
    assert.match(message.text, /it is live/);
    assert.doesNotMatch(message.text, /asked for changes/);
  });
});

describe('the routes send one decision email per owner', () => {
  function build({ role, requested, verified = false }: { role: 'admin' | 'owner'; requested: boolean; verified?: boolean }) {
    const sendDecision = mock.fn(async (_args: any) => true);
    const festival: any = { id: 'f-1', name: 'Fest', publishedAt: null };
    const deps: any = {
      express,
      config: {},
      log: { info() {}, warn() {}, error() {}, debug() {} },
      adminAuth: pass(),
      hasRecentAuth: () => true,
      requireRecentAuth: pass(),
      getFestivalById: async () => festival,
      publishChecklist: () => [],
      getRequestIp: () => '127.0.0.1',
      sendSuccess: (res: any, data: any) => res.json({ data, error: null }),
      sendError: (res: any, status: number, message: string, code: string) => res.status(status).json({ data: null, error: { message, code } }),
      ErrorCodes: { NOT_FOUND: 'NOT_FOUND', INTERNAL_ERROR: 'INTERNAL_ERROR', CONFLICT: 'CONFLICT', FORBIDDEN: 'FORBIDDEN' },
      rateLimit: pass,
      stores: {
        festivals: { publish: async () => ({ publishedAt: '2026-11-20T00:00:00.000Z' }) },
        festivalReview: {
          reviewState: async () => ({ requestedAt: requested ? new Date() : null, note: null }),
          declinePublish: async (_id: string, _note: string) => (requested ? { name: 'Fest', organizationId: 'org-a' } : null),
        },
        organizations: {
          getById: async () => ({ id: 'org-a', name: 'Org A' }),
          ownerEmails: async () => ['one@example.com', 'two@example.com'],
        },
      },
      emitter: { festivalCreated() {} },
      schemas: {},
      validate: pass,
      validateQuery: pass,
      validateParams: pass,
      invalidateFestivalCache: () => {},
      sendPublishDecisionEmail: sendDecision,
    };
    deps.festivalAccess = () => (req: any, _res: any, next: any) => {
      req.user = { userId: 'user-1' };
      req.festivalRole = role;
      if (role === 'admin') req.isAdmin = true;
      req.organizationId = 'org-a';
      req.orgVerified = verified;
      next();
    };
    const app = express();
    app.use(express.json());
    app.use(createFestivalsRoutes(deps));
    return { app, sendDecision };
  }

  test('a decline emails every owner once, with the note', async () => {
    const { app, sendDecision } = build({ role: 'admin', requested: true });
    await request(app).post('/f-1/publish/decline').send({ note: 'Add the address' }).expect(200);
    await settle();
    assert.equal(sendDecision.mock.callCount(), 2);
    const sent = sendDecision.mock.calls.map((call) => call.arguments[0]);
    assert.deepEqual(sent.map((a: any) => a.to), ['one@example.com', 'two@example.com']);
    assert.ok(sent.every((a: any) => a.decision === 'declined' && a.note === 'Add the address' && a.organizationName === 'Org A'));
  });

  test('a decline with no waiting request is 409 and sends nothing', async () => {
    const { app, sendDecision } = build({ role: 'admin', requested: false });
    await request(app).post('/f-1/publish/decline').send({ note: 'x' }).expect(409);
    await settle();
    assert.equal(sendDecision.mock.callCount(), 0);
  });

  test('an admin publish that answers a request emails the approval; one with no request emails nobody', async () => {
    const answered = build({ role: 'admin', requested: true });
    await request(answered.app).post('/f-1/publish').expect(200);
    await settle();
    assert.deepEqual(answered.sendDecision.mock.calls.map((c) => (c.arguments[0] as any).decision), ['approved', 'approved']);
    const unprompted = build({ role: 'admin', requested: false });
    await request(unprompted.app).post('/f-1/publish').expect(200);
    await settle();
    assert.equal(unprompted.sendDecision.mock.callCount(), 0);
  });

  test('a verified organization publishing its own festival emails nobody', async () => {
    const verified = build({ role: 'owner', requested: true, verified: true });
    await request(verified.app).post('/f-1/publish').expect(200);
    await settle();
    assert.equal(verified.sendDecision.mock.callCount(), 0);
  });
});
