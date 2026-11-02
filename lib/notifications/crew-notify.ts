// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * Crew notifier. Three paths, all best-effort (nothing here throws into a route):
 *   queue()   grouped: buffered per crew, one push per recipient per flush.
 *   now()     instant, to every member except the actor (meeting points).
 *   toUsers() instant, to named users (removed member, deleted crew, poll reminder).
 * Title is the crew name; type is `crew_update` (quiet hours and the opt-out are
 * enforced again by notificationService.send).
 */

const MAX_BUFFERED = 20;
const NOW_DEDUPE_MS = 2 * 60 * 1000;

type Kind = 'member' | 'poll' | 'meeting-point';
interface QueueItem {
  crewId: string;
  actorId: string | null;
  kind: 'member' | 'poll';
  text: string;
}

// T6 splits the crew switch into finer keys; until it merges every kind uses crewUpdates.
const PREF_KEYS: Record<Kind, string[]> = {
  member: ['crewUpdates'],
  poll: ['crewUpdates'],
  'meeting-point': ['crewUpdates'],
};

export function createCrewNotifier({ stores, notificationService, log, windowMs = 180_000, minGapMs = 300_000 }: any) {
  // shortcut: in-memory buffer, lost on a hard restart; move to a BullMQ delayed job if festie runs more than one instance.
  const pending = new Map<string, { items: QueueItem[]; timer: any }>();
  const lastFlushAt = new Map<string, number>();
  const lastNowAt = new Map<string, number>();

  const enabled = () => !!notificationService?.isConfigured;
  const warn = (msg: string, err: any, extra: object = {}) => log?.warn?.(msg, { error: err?.message, ...extra });
  const dataFor = (crewId: string) => ({ crewId, deepLink: `rave://crew/${crewId}` });

  async function allows(userId: string, kind: Kind) {
    try {
      const prefs = await stores.notificationPrefs?.get(userId);
      if (!prefs) return true;
      return PREF_KEYS[kind].every((k) => prefs[k] !== false && prefs[k] !== 0);
    } catch {
      return true;
    }
  }

  async function sendAll(userIds: string[], build: (userId: string) => any) {
    const results = await Promise.allSettled(userIds.map((userId) => notificationService.send(build(userId))));
    results.forEach((r, i) => {
      if (r.status === 'rejected') warn('crew push failed', r.reason, { userId: userIds[i] });
    });
  }

  function digestBody(texts: string[]) {
    const head = texts.slice(0, 2).join(' · ');
    return texts.length > 2 ? `${head} · +${texts.length - 2} more` : head;
  }

  async function flushCrew(crewId: string) {
    const entry = pending.get(crewId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(crewId);
    lastFlushAt.set(crewId, Date.now());
    try {
      const crew = await stores.crews.getById(crewId);
      if (!crew) return;
      const members = await stores.crews.getMembers(crewId);
      const textsByUser = new Map<string, string[]>();
      for (const m of members) {
        const texts: string[] = [];
        for (const item of entry.items) {
          if (item.actorId === m.userId) continue;
          if (await allows(m.userId, item.kind)) texts.push(item.text);
        }
        if (texts.length) textsByUser.set(m.userId, texts);
      }
      await sendAll([...textsByUser.keys()], (userId) => ({
        userId,
        type: 'crew_update',
        title: crew.name,
        body: digestBody(textsByUser.get(userId)!),
        data: dataFor(crewId),
        threadId: `crew-${crewId}`,
      }));
    } catch (err: any) {
      warn('crew digest flush failed', err, { crewId });
    }
  }

  function queue(item: QueueItem) {
    if (!enabled()) return;
    try {
      let entry = pending.get(item.crewId);
      if (!entry) {
        entry = { items: [], timer: null };
        pending.set(item.crewId, entry);
      }
      entry.items.push(item);
      if (entry.items.length > MAX_BUFFERED) entry.items.shift();
      if (entry.timer) return;
      const gapWait = (lastFlushAt.get(item.crewId) ?? -Infinity) + minGapMs - Date.now();
      entry.timer = setTimeout(() => void flushCrew(item.crewId), Math.max(windowMs, gapWait));
      entry.timer.unref?.();
    } catch (err: any) {
      warn('crew queue failed', err, { crewId: item.crewId });
    }
  }

  async function meetingTime(crewId: string, meetAt: string) {
    try {
      const { rows } = await stores.pool.query(
        'SELECT f.time_zone FROM crews c JOIN festivals f ON f.id = c.festival_id WHERE c.id = $1',
        [crewId],
      );
      const timeZone = rows[0]?.time_zone;
      if (!timeZone) return null;
      return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(meetAt));
    } catch (err: any) {
      if (!(err instanceof RangeError)) warn('meeting time lookup failed', err, { crewId });
      return null;
    }
  }

  async function now(item: {
    crewId: string;
    actorId: string | null;
    kind: 'meeting-point';
    text: string;
    key: string;
    meetAt?: string | null;
  }) {
    if (!enabled()) return;
    try {
      const prev = lastNowAt.get(item.key);
      if (prev !== undefined && Date.now() - prev < NOW_DEDUPE_MS) return;
      lastNowAt.set(item.key, Date.now());
      const crew = await stores.crews.getById(item.crewId);
      if (!crew) return;
      // A "moved X to" text ends in " to" and takes the time bare; "set a meeting point: X" takes " at <time>".
      const moved = item.text.endsWith(' to');
      const time = item.meetAt ? await meetingTime(item.crewId, item.meetAt) : null;
      let body = item.text;
      if (time) body += moved ? ` ${time}` : ` at ${time}`;
      else if (moved) body = item.text.slice(0, -3);
      const members = await stores.crews.getMembers(item.crewId);
      const recipients: string[] = [];
      for (const m of members) {
        if (m.userId !== item.actorId && (await allows(m.userId, item.kind))) recipients.push(m.userId);
      }
      await sendAll(recipients, (userId) => ({
        userId,
        type: 'crew_update',
        title: crew.name,
        body,
        data: dataFor(item.crewId),
        threadId: `crew-mp-${item.crewId}`,
      }));
    } catch (err: any) {
      warn('crew instant push failed', err, { crewId: item.crewId });
    }
  }

  async function toUsers(item: {
    crewId: string;
    crewName?: string;
    userIds: string[];
    text: string;
    kind: 'member' | 'poll';
  }) {
    if (!enabled()) return;
    try {
      const title = item.crewName || (await stores.crews.getById(item.crewId))?.name || 'Festie';
      await sendAll(item.userIds, (userId) => ({
        userId,
        type: 'crew_update',
        title,
        body: item.text,
        data: dataFor(item.crewId),
        threadId: `crew-${item.crewId}`,
      }));
    } catch (err: any) {
      warn('crew targeted push failed', err, { crewId: item.crewId });
    }
  }

  async function flushAll() {
    if (!enabled()) return;
    await Promise.allSettled([...pending.keys()].map((crewId) => flushCrew(crewId)));
  }

  return { queue, now, toUsers, flushAll };
}
