// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Poll closer: the announce work shared by a manual "End poll" (DELETE route)
 * and the sweep that ends polls whose `closes_at` has passed.
 *
 * announce() writes the result: T2's meeting point for a single winning set,
 * the `poll-closed` feed row, the `crew:poll-closed` socket event and the
 * digest push. Each step catches its own error, so one failure never blocks
 * the others and nothing throws into the caller.
 */

import { MAX_MEETING_POINTS_PER_CREW } from './constants.js';

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// The most votes wins; two or more options on the top count is a tie; zero votes is no result.
function decide(question: string, options: string[], counts: number[]) {
  const perOption = options.map((_, i) => counts[i] ?? 0);
  const top = Math.max(0, ...perOption);
  const leaders = top > 0 ? perOption.flatMap((n, i) => (n === top ? [i] : [])) : [];
  const q = `"${String(question).slice(0, 80)}"`;
  let result = 'Ended with no votes';
  if (leaders.length === 1) result = `Decided: ${options[leaders[0]!]}`;
  else if (leaders.length > 1) result = `Tie: ${joinNames(leaders.map((i) => options[i]!))}`;
  return { text: `${q} — ${result}`.slice(0, 200), winnerIndex: leaders.length === 1 ? leaders[0]! : null };
}

export function pollDecisionText(question: string, options: string[], counts: number[]) {
  return decide(question, options, counts).text;
}

export function createPollCloser({ stores, io, emitter, crewNotify, createOpaqueId, log }: any) {
  async function announce(poll: any, actorId: string | null) {
    const crewId = poll.crew_id;
    const by = actorId ?? poll.created_by;
    const options: string[] = Array.isArray(poll.options) ? poll.options : [];

    let counts: number[] = [];
    try {
      counts = await stores.polls.tallyVotes(poll.id);
    } catch (err: any) {
      log.warn('poll close tally failed', { error: err.message, pollId: poll.id });
    }
    const { text, winnerIndex } = decide(poll.question, options, counts);

    const setRefs = Array.isArray(poll.set_refs) ? poll.set_refs : [];
    const ref = winnerIndex !== null ? (setRefs[winnerIndex] ?? null) : null;
    let meetingPoint: any = null;
    if (ref) {
      try {
        const count = await stores.crews.meetingPoints.countByCrew(crewId);
        if (count < MAX_MEETING_POINTS_PER_CREW) {
          const meetAt = ref.meetAt ?? null;
          meetingPoint = await stores.crews.meetingPoints.create({
            id: createOpaqueId('mp'),
            crewId,
            createdBy: by,
            label: String(ref.label).slice(0, 100),
            location: ref.stageReference || ref.label,
            type: 'set',
            meetAt,
            stageReference: ref.stageReference ?? null,
            expiresAt: meetAt ? new Date(new Date(meetAt).getTime() + 30 * 60_000).toISOString() : null,
            latitude: null,
            longitude: null,
            recursDaily: false,
          });
          io.to('crew:' + crewId).emit('crew:meeting-point-created', meetingPoint);
        }
      } catch (err: any) {
        log.warn('poll close meeting point failed', { error: err.message, pollId: poll.id });
      }
    }

    try {
      const activity = { crewId, userId: by, type: 'poll-closed', detail: text };
      const id = await stores.activity.log(activity);
      emitter.crewActivityLogged({ crewId, item: { id, ...activity } });
    } catch (err: any) {
      log.warn('poll close activity failed', { error: err.message, pollId: poll.id });
    }

    try {
      io.to('crew:' + crewId).emit('crew:poll-closed', { pollId: poll.id });
    } catch (err: any) {
      log.warn('poll close emit failed', { error: err.message, pollId: poll.id });
    }

    try {
      crewNotify?.queue({ crewId, actorId, kind: 'poll', text });
    } catch (err: any) {
      log.warn('poll close push failed', { error: err.message, pollId: poll.id });
    }

    return { meetingPoint, winningSetId: ref?.setId ?? null };
  }

  async function sweepExpired() {
    const rows = await stores.polls.closeExpired();
    for (const row of rows) await announce(row, null);
    return rows.length;
  }

  return { announce, sweepExpired };
}
