// PUT /profiles/:id calls interestConversion.convert only when a newly added mark has something to convert:
// a scheduled act whose mark is not converted yet. Otherwise each write would queue a festival-lock transaction.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import express from 'express';
import request from 'supertest';
import createProfilesRoutes from '../routes/profiles.js';

const noop = () => {};
const pass = (_req: any, _res: any, next: any) => next();

function setup(interests: Record<string, any>) {
  const calls: string[] = [];
  const festival = {
    id: 'fest-1',
    lineup: [
      { id: 'lu-sched', artists: [{ name: 'Alpha' }] },
      { id: 'lu-ann', artists: [{ name: 'Zeta' }] },
    ],
    days: [{ sets: [{ id: 'set-a', artist: 'Alpha' }] }],
  };
  const profile = { id: 'p1', userId: 'u1', festivalId: 'fest-1', interests };
  const deps: any = {
    express,
    log: { info: noop, warn: noop, error: noop },
    userAuth: (req: any, _res: any, next: any) => {
      req.user = { userId: 'u1' };
      next();
    },
    adminAuth: pass,
    setNoStore: noop,
    getFestivalById: async () => festival,
    getUserById: async () => ({ id: 'u1' }),
    serializeOwnProfile: (p: any) => p,
    sendSuccess: (res: any, data: any) => res.json({ data }),
    sendError: (res: any, status: number, message: string) => res.status(status).json({ error: message }),
    ErrorCodes: {},
    rateLimit: () => pass,
    emitter: { profileUpdated: noop },
    schemas: {},
    validate: () => (req: any, _res: any, next: any) => {
      req.validatedBody = req.body;
      next();
    },
    validateParams: () => (req: any, _res: any, next: any) => {
      req.validatedParams = req.params;
      next();
    },
    validateQuery: () => pass,
    stores: { profiles: { getById: async () => profile, update: async () => profile } },
    interestConversion: { convert: async (id: string) => void calls.push(id) },
  };
  const app = express();
  app.use(express.json());
  app.use(createProfilesRoutes(deps));
  return { calls, put: (body: any) => request(app).put('/p1').send(body).expect(200) };
}

describe('PUT /profiles/:id interest conversion trigger', () => {
  test('a mark on an act that is not scheduled does not convert', async () => {
    const { calls, put } = setup({ 'lu-ann': { state: 'open' } });
    await put({ interestAdd: ['lu-ann'] });
    assert.deepEqual(calls, []);
  });

  test('a mark that is already converted does not convert again', async () => {
    const { calls, put } = setup({ 'lu-sched': { state: 'converted', sets: ['set-a'] } });
    await put({ interestAdd: ['lu-sched'] });
    assert.deepEqual(calls, []);
  });

  test('an open mark on a scheduled act converts', async () => {
    const { calls, put } = setup({ 'lu-sched': { state: 'open' } });
    await put({ interestAdd: ['lu-sched'] });
    assert.deepEqual(calls, ['fest-1']);
  });
});
