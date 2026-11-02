/**
 * Unit tests for lib/poll-close.ts — result text, announce and the expiry sweep.
 * No database: every store is a mock.fn() stub.
 */

import assert from 'node:assert/strict';
import { describe, test, mock } from 'node:test';

import { createPollCloser, pollDecisionText } from '../lib/poll-close.js';

const noop = () => {};

function makeCloser(over: any = {}) {
  const emit = mock.fn(noop);
  const io = { to: mock.fn(() => ({ emit })) };
  const stores = {
    polls: {
      tallyVotes: mock.fn(async () => over.counts ?? []),
      closeExpired: mock.fn(async () => over.expired ?? []),
    },
    crews: {
      meetingPoints: {
        countByCrew: mock.fn(async () => 0),
        create: mock.fn(async (d: any) => ({ id: d.id, label: d.label })),
      },
    },
    activity: { log: over.activityLog ?? mock.fn(async () => 'act-1') },
  };
  const emitter = { crewActivityLogged: mock.fn(noop) };
  const crewNotify = { queue: mock.fn(noop) };
  const log = { info: noop, warn: mock.fn(noop), error: noop, debug: noop };
  const closer = createPollCloser({ stores, io, emitter, crewNotify, createOpaqueId: (p: string) => `${p}-x`, log });
  const events = () => (emit.mock.calls as any[]).map((c) => c.arguments[0]);
  return { closer, stores, emitter, crewNotify, events };
}

const SET_REFS = [
  { setId: 's0', label: 'Tacos stage', stageReference: 'Main', meetAt: null },
  { setId: 's1', label: 'Pizza stage', stageReference: 'Tent', meetAt: null },
];
const POLL = {
  id: 'poll-1',
  crew_id: 'crew-1',
  created_by: 'creator',
  question: 'Dinner?',
  options: ['Tacos', 'Pizza'],
  set_refs: SET_REFS,
};

describe('pollDecisionText', () => {
  test('winner', () => {
    assert.equal(pollDecisionText('Dinner?', ['Tacos', 'Pizza'], [3, 1]), '"Dinner?" — Decided: Tacos');
  });
  test('tie of two', () => {
    assert.equal(pollDecisionText('Dinner?', ['Tacos', 'Pizza', 'Sushi'], [2, 2, 1]), '"Dinner?" — Tie: Tacos and Pizza');
  });
  test('tie of three', () => {
    assert.equal(pollDecisionText('Dinner?', ['A', 'B', 'C'], [1, 1, 1]), '"Dinner?" — Tie: A, B and C');
  });
  test('no votes, including a short counts array', () => {
    assert.equal(pollDecisionText('Dinner?', ['A', 'B'], []), '"Dinner?" — Ended with no votes');
  });
  test('cuts the question to 80 and the text to 200', () => {
    const text = pollDecisionText('Q'.repeat(300), ['O'.repeat(200), 'B'], [1, 0]);
    assert.ok(text.startsWith(`"${'Q'.repeat(80)}"`));
    assert.equal(text.length, 200);
  });
});

describe('createPollCloser — announce', () => {
  test('a single winner makes the meeting point and returns its set id', async () => {
    const { closer, stores, events } = makeCloser({ counts: [1, 2] });
    const out = await closer.announce(POLL, 'closer');
    assert.equal(out.winningSetId, 's1');
    assert.equal(out.meetingPoint.label, 'Pizza stage');
    const arg = (stores.crews.meetingPoints.create.mock.calls as any[])[0].arguments[0];
    assert.equal(arg.createdBy, 'closer');
    assert.deepEqual(events(), ['crew:meeting-point-created', 'crew:poll-closed']);
  });

  test('a tie makes no meeting point and returns winningSetId null', async () => {
    const { closer, stores } = makeCloser({ counts: [2, 2] });
    const out = await closer.announce(POLL, 'closer');
    assert.deepEqual(out, { meetingPoint: null, winningSetId: null });
    assert.equal(stores.crews.meetingPoints.create.mock.calls.length, 0);
  });

  test('announce(poll, null) writes the row as the creator and queues with actorId null', async () => {
    const { closer, stores, emitter, crewNotify } = makeCloser({ counts: [0, 1] });
    await closer.announce(POLL, null);
    const row = (stores.activity.log.mock.calls as any[])[0].arguments[0];
    assert.deepEqual(row, { crewId: 'crew-1', userId: 'creator', type: 'poll-closed', detail: '"Dinner?" — Decided: Pizza' });
    assert.deepEqual((emitter.crewActivityLogged.mock.calls as any[])[0].arguments[0], {
      crewId: 'crew-1',
      item: { id: 'act-1', ...row },
    });
    assert.deepEqual((crewNotify.queue.mock.calls as any[])[0].arguments[0], {
      crewId: 'crew-1',
      actorId: null,
      kind: 'poll',
      text: '"Dinner?" — Decided: Pizza',
    });
    const mp = (stores.crews.meetingPoints.create.mock.calls as any[])[0].arguments[0];
    assert.equal(mp.createdBy, 'creator');
  });

  test('a throwing activity store still emits and queues', async () => {
    const { closer, events, crewNotify } = makeCloser({
      counts: [1, 0],
      activityLog: mock.fn(async () => {
        throw new Error('db down');
      }),
    });
    await closer.announce({ ...POLL, set_refs: null }, 'closer');
    assert.ok(events().includes('crew:poll-closed'));
    assert.equal(crewNotify.queue.mock.calls.length, 1);
  });
});

describe('createPollCloser — sweepExpired', () => {
  test('announces each row from closeExpired as a timed-out poll', async () => {
    const expired = [
      { ...POLL, id: 'poll-a', set_refs: null },
      { ...POLL, id: 'poll-b', set_refs: null },
    ];
    const { closer, stores, crewNotify, events } = makeCloser({ expired, counts: [1, 0] });
    assert.equal(await closer.sweepExpired(), 2);
    assert.deepEqual(
      (stores.polls.tallyVotes.mock.calls as any[]).map((c) => c.arguments[0]),
      ['poll-a', 'poll-b'],
    );
    assert.deepEqual(events(), ['crew:poll-closed', 'crew:poll-closed']);
    assert.ok((crewNotify.queue.mock.calls as any[]).every((c) => c.arguments[0].actorId === null));
  });

  test('returns 0 when nothing has expired', async () => {
    const { closer } = makeCloser();
    assert.equal(await closer.sweepExpired(), 0);
  });
});
