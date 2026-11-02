import { formatUptime } from './timeAgo';

export interface AdminHealth {
  uptime: number;
  memory?: { rss: number } | null;
  connections?: number;
  onlineRooms?: number;
  database?: { totalCount: number; idleCount: number; waitingCount: number } | null;
  recent?: { minutes: number; requests: number; serverErrors: number } | null;
}

export interface DashboardStats {
  users: number;
  festivals: number;
  profiles: number;
  picks: number;
}

// Warn only when errors are both frequent (5+) and at least 2% of requests, so one stray 500 stays quiet.
const WARN_MIN_ERRORS = 5;
const WARN_ERROR_RATE = 0.02;

const pct = (n: number, d: number): string => `${d > 0 ? Math.round((n / d) * 100) : 0}%`;

export function describeHealth(health: AdminHealth | null | undefined): { tone: 'ok' | 'warn' | 'unknown'; text: string } {
  const recent = health?.recent;
  if (!health || !recent) return { tone: 'unknown', text: 'Health numbers are not available.' };
  const waiting = health.database?.waitingCount ?? 0;
  if (waiting > 0) {
    return { tone: 'warn', text: `The database is busy: ${waiting} requests are waiting for a connection.` };
  }
  const { serverErrors: e, requests } = recent;
  if (e >= WARN_MIN_ERRORS && e / requests >= WARN_ERROR_RATE) {
    return {
      tone: 'warn',
      text: `Server errors are up: ${e} in the last 15 minutes (${pct(e, requests)} of requests). Check the status page.`,
    };
  }
  if (e > 0) {
    return {
      tone: 'ok',
      text: `Working. ${e} server ${e === 1 ? 'error' : 'errors'} in the last 15 minutes (${pct(e, requests)} of requests).`,
    };
  }
  return { tone: 'ok', text: 'All good. No server errors in the last 15 minutes.' };
}

export function healthDetailRows(health: AdminHealth): Array<{ label: string; value: string }> {
  const rows = [
    { label: 'Running for', value: formatUptime(health.uptime) },
    { label: 'Requests (last 15 min)', value: String(health.recent?.requests ?? 0) },
    { label: 'Server errors (last 15 min)', value: String(health.recent?.serverErrors ?? 0) },
    { label: 'Live connections', value: String(health.connections ?? 0) },
    { label: 'People online now', value: String(health.onlineRooms ?? 0) },
    { label: 'Memory in use', value: `${health.memory?.rss ?? 0} MB` },
  ];
  const db = health.database;
  if (db) {
    rows.push({
      label: 'Database connections',
      value: `${db.totalCount - db.idleCount} in use, ${db.idleCount} idle, ${db.waitingCount} waiting`,
    });
  }
  return rows;
}

export function dashboardStatRows(stats: DashboardStats): Array<{
  key: 'users' | 'festivals' | 'profiles' | 'picks';
  label: string;
  hint: string;
  value: number;
  target: 'users' | 'festivals' | 'analytics';
}> {
  return [
    { key: 'users', label: 'Users', hint: 'Accounts that are not deleted', value: stats.users, target: 'users' },
    { key: 'festivals', label: 'Festivals', hint: 'Festivals that are not deleted', value: stats.festivals, target: 'festivals' },
    { key: 'profiles', label: 'Festival plans', hint: "One person's plan for one festival", value: stats.profiles, target: 'analytics' },
    { key: 'picks', label: 'Total picks', hint: 'Sets added to plans', value: stats.picks, target: 'analytics' },
  ];
}
