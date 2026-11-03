// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

/**
 * The records a user wrote in crews and on sets, for GET /account/export
 * (exportVersion 1.2). Each section is one query that takes the user id as its
 * only parameter. A section that fails is exported as [] and logged as
 * gdpr-export:partial-failure, so one missing table never blocks the export.
 *
 * Only the user's own data leaves here: no other member's id, vote, seat, day
 * answer or tap, and no secret (a calendar token id is the feed secret).
 */

import type { Pool } from 'pg';

type ExportRow = Record<string, unknown>;
type ExportLog = { warn: (message: string, meta?: Record<string, unknown>) => void };

export const isoOrNull = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

const numberOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export async function collectAuthoredRecords(pool: Pick<Pool, 'query'>, userId: string, log: ExportLog) {
  // Sections run in sequence: one export a day per user needs no parallel queries.
  const section = async (name: string, sql: string, mapRow: (r: ExportRow) => Record<string, unknown>) => {
    try {
      const { rows } = await pool.query(sql, [userId]);
      return (rows as ExportRow[]).map(mapRow);
    } catch (error) {
      log.warn('gdpr-export:partial-failure', { section: name, userId, error: (error as Error).message });
      return [];
    }
  };

  const ratings = await section(
    'ratings',
    `
  SELECT
    r.set_id,
    s.festival_id,
    s.artist,
    r.rating,
    r.note,
    r.created_at,
    r.updated_at
  FROM
    set_ratings r
    LEFT JOIN festival_sets s ON s.id = r.set_id
  WHERE
    r.user_id = $1
  ORDER BY
    r.created_at
`,
    (r) => ({
      setId: r.set_id,
      festivalId: r.festival_id ?? null,
      artist: r.artist ?? null,
      rating: r.rating,
      note: r.note ?? null,
      createdAt: isoOrNull(r.created_at),
      updatedAt: isoOrNull(r.updated_at),
    }),
  );

  const caught = await section(
    'caught',
    `
  SELECT
    c.set_id,
    s.festival_id,
    s.artist,
    c.caught,
    c.updated_at
  FROM
    set_caught c
    LEFT JOIN festival_sets s ON s.id = c.set_id
  WHERE
    c.user_id = $1
  ORDER BY
    c.updated_at
`,
    (r) => ({
      setId: r.set_id,
      festivalId: r.festival_id ?? null,
      artist: r.artist ?? null,
      caught: r.caught === true,
      updatedAt: isoOrNull(r.updated_at),
    }),
  );

  const followedFestivals = await section(
    'followedFestivals',
    `
  SELECT
    ff.festival_id,
    f.name AS festival_name,
    ff.created_at
  FROM
    festival_follows ff
    LEFT JOIN festivals f ON f.id = ff.festival_id
  WHERE
    ff.user_id = $1
  ORDER BY
    ff.created_at
`,
    (r) => ({
      festivalId: r.festival_id,
      festivalName: r.festival_name ?? null,
      followedAt: isoOrNull(r.created_at),
    }),
  );

  // The last clause covers even splits over the whole crew (split_with = []).
  // split_with, split_amounts, paid_by, created_by and updated_by hold other
  // members' ids, so only booleans and the user's own share leave the query.
  const expenses = await section(
    'expenses',
    `
  SELECT
    id,
    crew_id,
    description,
    amount,
    category,
    planned,
    paid_by = $1 AS paid_by_you,
    COALESCE(created_by = $1, FALSE) AS added_by_you,
    (split_amounts ->> $1)::int AS your_share_cents,
    created_at,
    updated_at,
    confirmed_at,
    disputed_at
  FROM
    crew_expenses
  WHERE
    paid_by = $1
    OR created_by = $1
    OR split_with @> jsonb_build_array($1::text)
    OR split_amounts ? $1
    OR (
      split_with = '[]'::jsonb
      AND crew_id IN (
        SELECT
          crew_id
        FROM
          crew_members
        WHERE
          user_id = $1
      )
    )
  ORDER BY
    created_at
`,
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      description: r.description,
      amount: Number(r.amount),
      category: r.category ?? null,
      planned: r.planned === true,
      paidByYou: r.paid_by_you === true,
      addedByYou: r.added_by_you === true,
      yourShareCents: numberOrNull(r.your_share_cents),
      createdAt: isoOrNull(r.created_at),
      updatedAt: isoOrNull(r.updated_at),
      confirmedAt: isoOrNull(r.confirmed_at),
      disputedAt: isoOrNull(r.disputed_at),
    }),
  );

  const pollsCreated = await section(
    'pollsCreated',
    `
  SELECT
    id,
    crew_id,
    question,
    ARRAY(
      SELECT
        jsonb_array_elements_text(options)
    ) AS options,
    multi_answer,
    created_at,
    closed_at
  FROM
    crew_polls
  WHERE
    created_by = $1
  ORDER BY
    created_at
`,
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      question: r.question,
      options: r.options ?? [],
      multiAnswer: r.multi_answer === true,
      createdAt: isoOrNull(r.created_at),
      closedAt: isoOrNull(r.closed_at),
    }),
  );

  const pollVotes = await section(
    'pollVotes',
    `
  SELECT
    v.poll_id,
    p.crew_id,
    p.question,
    ARRAY(
      SELECT
        p.options ->> i
      FROM
        unnest(COALESCE(v.option_indexes, ARRAY[v.option_index])) AS i
    ) AS options,
    v.voted_at
  FROM
    crew_poll_votes v
    JOIN crew_polls p ON p.id = v.poll_id
  WHERE
    v.user_id = $1
  ORDER BY
    v.voted_at
`,
    (r) => ({
      pollId: r.poll_id,
      crewId: r.crew_id,
      question: r.question,
      options: r.options ?? [],
      votedAt: isoOrNull(r.voted_at),
    }),
  );

  // brought_by holds the claimer's user id, so only booleans leave the query.
  const packingItems = await section(
    'packingItems',
    `
  SELECT
    id,
    crew_id,
    label,
    created_by = $1 AS added_by_you,
    COALESCE(brought_by = $1, FALSE) AS bringing,
    claimed,
    packed,
    created_at
  FROM
    crew_packing_items
  WHERE
    created_by = $1
    OR brought_by = $1
  ORDER BY
    created_at
`,
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      label: r.label,
      addedByYou: r.added_by_you === true,
      bringing: r.bringing === true,
      claimed: r.claimed === true,
      packed: r.packed === true,
      createdAt: isoOrNull(r.created_at),
    }),
  );

  const rides = await section(
    'rides',
    `
  SELECT
    id,
    crew_id,
    driver,
    seats,
    direction,
    depart_from,
    depart_at,
    depart_time,
    note,
    created_at
  FROM
    crew_ride_offers
  WHERE
    created_by = $1
  ORDER BY
    created_at
`,
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      driver: r.driver ?? null,
      seats: r.seats ?? null,
      direction: r.direction ?? null,
      departFrom: r.depart_from ?? null,
      // depart_at is free TEXT (migration 047), not a timestamp, so it is exported as stored.
      departAt: r.depart_at ?? null,
      departTime: isoOrNull(r.depart_time),
      note: r.note ?? null,
      createdAt: isoOrNull(r.created_at),
    }),
  );

  const rideSeats = await section(
    'rideSeats',
    `
  SELECT
    rp.ride_id,
    o.crew_id,
    rp.created_at
  FROM
    crew_ride_passengers rp
    JOIN crew_ride_offers o ON o.id = rp.ride_id
  WHERE
    rp.user_id = $1
  ORDER BY
    rp.created_at
`,
    (r) => ({ rideId: r.ride_id, crewId: r.crew_id, joinedAt: isoOrNull(r.created_at) }),
  );

  const meetingPoints = await section(
    'meetingPoints',
    `
  SELECT
    id,
    crew_id,
    label,
    location,
    latitude,
    longitude,
    type,
    meet_at,
    created_at
  FROM
    crew_meeting_points
  WHERE
    created_by = $1
  ORDER BY
    created_at
`,
    (r) => ({
      id: r.id,
      crewId: r.crew_id,
      label: r.label,
      location: r.location ?? null,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      type: r.type ?? null,
      meetAt: isoOrNull(r.meet_at),
      createdAt: isoOrNull(r.created_at),
    }),
  );

  const crewActivity = await section(
    'crewActivity',
    `
  SELECT
    crew_id,
    type,
    detail,
    created_at
  FROM
    crew_activity
  WHERE
    user_id = $1
  ORDER BY
    created_at
`,
    (r) => ({ crewId: r.crew_id, type: r.type, detail: r.detail ?? null, createdAt: isoOrNull(r.created_at) }),
  );

  // Never the id: it is the feed URL secret.
  const calendarFeeds = await section(
    'calendarFeeds',
    `
  SELECT
    festival_id,
    created_at
  FROM
    calendar_tokens
  WHERE
    user_id = $1
  ORDER BY
    created_at
`,
    (r) => ({ festivalId: r.festival_id, createdAt: isoOrNull(r.created_at) }),
  );

  // Never to_user_id: it is another member's id.
  const paymentRemindersSent = await section(
    'paymentRemindersSent',
    `
  SELECT
    crew_id,
    sent_on::text AS sent_on
  FROM
    crew_expense_reminders
  WHERE
    from_user_id = $1
  ORDER BY
    sent_on
`,
    (r) => ({ crewId: r.crew_id, sentOn: r.sent_on ?? null }),
  );

  const crewDays = await section(
    'crewDays',
    `
  SELECT
    crew_id,
    day_index,
    answer,
    updated_at
  FROM
    crew_member_days
  WHERE
    user_id = $1
  ORDER BY
    crew_id,
    day_index
`,
    (r) => ({ crewId: r.crew_id, dayIndex: r.day_index, answer: r.answer, updatedAt: isoOrNull(r.updated_at) }),
  );

  const meetingPointsComing = await section(
    'meetingPointsComing',
    `
  SELECT
    meeting_point_id,
    crew_id,
    created_at
  FROM
    crew_meeting_point_coming
  WHERE
    user_id = $1
  ORDER BY
    created_at
`,
    (r) => ({ meetingPointId: r.meeting_point_id, crewId: r.crew_id, createdAt: isoOrNull(r.created_at) }),
  );

  return {
    ratings,
    caught,
    followedFestivals,
    expenses,
    pollsCreated,
    pollVotes,
    packingItems,
    rides,
    rideSeats,
    meetingPoints,
    crewActivity,
    calendarFeeds,
    paymentRemindersSent,
    crewDays,
    meetingPointsComing,
  };
}
