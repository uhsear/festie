import type { Pool } from 'pg';

export function createTopicSubscriptionsStore(pool: Pool) {
  // #29: Topic subscription store
  const topicSubscriptions = {
    async getForUser(userId: string, festivalId: string) {
      const result = await pool.query(
        `
        SELECT
          topic,
          subscribed
        FROM
          notification_topic_subs
        WHERE
          user_id = $1
          AND festival_id = $2
      `,
        [userId, festivalId],
      );
      const subs: Record<string, boolean> = Object.create(null);
      for (const row of result.rows) subs[row.topic] = !!row.subscribed;
      return subs;
    },

    async setSubscription(userId: string, festivalId: string, topic: string, subscribed: boolean) {
      await pool.query(
        `
        INSERT INTO notification_topic_subs (user_id, festival_id, topic, subscribed, updated_at)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT(user_id, festival_id, topic) DO UPDATE SET
          subscribed = EXCLUDED.subscribed,
          updated_at = NOW()
      `,
        [userId, festivalId, topic, subscribed ? 1 : 0],
      );
    },

    async isSubscribed(userId: string, festivalId: string, topic: string) {
      const result = await pool.query(
        `
        SELECT
          subscribed
        FROM
          notification_topic_subs
        WHERE
          user_id = $1
          AND festival_id = $2
          AND topic = $3
      `,
        [userId, festivalId, topic],
      );
      // Default to subscribed if no explicit preference
      return result.rows[0] ? !!result.rows[0].subscribed : true;
    },

    async getUnsubscribedUsers(festivalId: string, topic: string) {
      const result = await pool.query(
        `
        SELECT
          user_id AS "userId"
        FROM
          notification_topic_subs
        WHERE
          festival_id = $1
          AND topic = $2
          AND subscribed = 0
      `,
        [festivalId, topic],
      );
      return new Set(result.rows.map((r: any) => r.userId));
    },
  };

  return topicSubscriptions;
}
