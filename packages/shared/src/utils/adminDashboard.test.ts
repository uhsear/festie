import { describe, it, expect } from 'vitest';
import { describeHealth, healthDetailRows, dashboardStatRows, type AdminHealth } from './adminDashboard';

const health = ({ errors = 0, requests = 1000, ...rest }: Partial<AdminHealth> & { errors?: number; requests?: number } = {}): AdminHealth => ({
  uptime: 90_000,
  memory: { rss: 120 },
  connections: 4,
  onlineRooms: 2,
  database: { totalCount: 5, idleCount: 3, waitingCount: 0 },
  recent: { minutes: 15, requests, serverErrors: errors },
  ...rest,
});

describe('describeHealth', () => {
  it('is unknown without health or recent', () => {
    const unknown = { tone: 'unknown', text: 'Health numbers are not available.' };
    expect(describeHealth(undefined)).toEqual(unknown);
    expect(describeHealth({ uptime: 1 })).toEqual(unknown);
  });

  it('warns when requests wait for the database', () => {
    const h = health({ database: { totalCount: 5, idleCount: 0, waitingCount: 2 } });
    expect(describeHealth(h)).toEqual({
      tone: 'warn',
      text: 'The database is busy: 2 requests are waiting for a connection.',
    });
  });

  it('warns at 5 errors and 2 percent', () => {
    expect(describeHealth(health({ errors: 20, requests: 1000 }))).toEqual({
      tone: 'warn',
      text: 'Server errors are up: 20 in the last 15 minutes (2% of requests). Check the status page.',
    });
  });

  it('stays ok at 4 errors, and at 5 errors under 2 percent', () => {
    expect(describeHealth(health({ errors: 4, requests: 10 })).tone).toBe('ok');
    expect(describeHealth(health({ errors: 5, requests: 1000 }))).toEqual({
      tone: 'ok',
      text: 'Working. 5 server errors in the last 15 minutes (1% of requests).',
    });
  });

  it('uses the singular for one error', () => {
    expect(describeHealth(health({ errors: 1, requests: 100 })).text).toBe(
      'Working. 1 server error in the last 15 minutes (1% of requests).',
    );
  });

  it('says all good with no errors', () => {
    expect(describeHealth(health())).toEqual({
      tone: 'ok',
      text: 'All good. No server errors in the last 15 minutes.',
    });
  });
});

describe('healthDetailRows', () => {
  it('lists plain rows', () => {
    expect(healthDetailRows(health({ errors: 2, requests: 50 }))).toEqual([
      { label: 'Running for', value: '1d 1h 0m' },
      { label: 'Requests (last 15 min)', value: '50' },
      { label: 'Server errors (last 15 min)', value: '2' },
      { label: 'Live connections', value: '4' },
      { label: 'People online now', value: '2' },
      { label: 'Memory in use', value: '120 MB' },
      { label: 'Database connections', value: '2 in use, 3 idle, 0 waiting' },
    ]);
  });

  it('leaves out the database row when database is null', () => {
    const rows = healthDetailRows(health({ database: null }));
    expect(rows.map((r) => r.label)).not.toContain('Database connections');
  });
});

describe('dashboardStatRows', () => {
  it('labels stats and sets targets', () => {
    const rows = dashboardStatRows({ users: 11, festivals: 3, profiles: 20, picks: 400 });
    expect(rows.map((r) => [r.key, r.label, r.value, r.target])).toEqual([
      ['users', 'Users', 11, 'users'],
      ['festivals', 'Festivals', 3, 'festivals'],
      ['profiles', 'Festival plans', 20, 'analytics'],
      ['picks', 'Total picks', 400, 'analytics'],
    ]);
    expect(rows[2].hint).toBe("One person's plan for one festival");
  });
});
