import { describe, it, expect } from 'vitest';
import {
  AUDIT_ACTION_LABELS,
  auditActionLabel,
  parseAuditQuery,
  removeAuditQueryToken,
  setAuditQueryAction,
  describeAuditChanges,
  auditEntriesToCsv,
} from './auditActions';

describe('auditActionLabel', () => {
  it.each(Object.entries(AUDIT_ACTION_LABELS))('labels %s', (action, label) => {
    expect(auditActionLabel(action)).toBe(label);
  });

  it('has the 25 table labels', () => {
    expect(Object.keys(AUDIT_ACTION_LABELS)).toHaveLength(25);
    expect(AUDIT_ACTION_LABELS['user.role.revoked']).toBe('Role removed');
  });

  it('labels the T34, T35 and announcement actions', () => {
    expect(auditActionLabel('festival.siteplan.uploaded')).toBe('Site plan uploaded');
    expect(auditActionLabel('festival.announcement.sent')).toBe('Announcement sent');
    expect(auditActionLabel('festival.announcement.cancelled')).toBe('Announcement cancelled');
    expect(auditActionLabel('user.private_data.viewed')).toBe('User details viewed');
    expect(auditActionLabel('crew.member.added')).toBe('Crew member added');
  });

  it('falls back for generic dotted rows', () => {
    expect(auditActionLabel('crews.created')).toBe('Crews created');
    expect(auditActionLabel('push-tokens.deleted')).toBe('Push tokens deleted');
  });

  it('falls back for old colon rows', () => {
    expect(auditActionLabel('create:token')).toBe('Token created');
  });

  it('falls back to spaced text for anything else', () => {
    expect(auditActionLabel('user.profile_photo.viewed')).toBe('User profile photo viewed');
    expect(auditActionLabel('weird_thing')).toBe('Weird thing');
  });
});

describe('parseAuditQuery', () => {
  it('parses each key', () => {
    const r = parseAuditQuery('actor:asir user:sam action:festival.* after:2026-10-01 before:2026-10-31');
    expect(r.errors).toEqual([]);
    expect(r.filters).toEqual({
      actor: 'asir',
      user: 'sam',
      action: 'festival.*',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T23:59:59.999Z',
    });
    expect(r.tokens.map((t) => t.key)).toEqual(['actor', 'user', 'action', 'after', 'before']);
    expect(r.tokens[0]).toEqual({ key: 'actor', value: 'asir', raw: 'actor:asir' });
  });

  it('keeps the last value of a repeated key', () => {
    expect(parseAuditQuery('actor:a actor:b').filters.actor).toBe('b');
  });

  it('reports a bad date', () => {
    const r = parseAuditQuery('after:2026-13-45');
    expect(r.errors).toEqual(['"after:2026-13-45" is not a date. Use YYYY-MM-DD.']);
    expect(r.filters.from).toBeUndefined();
  });

  it('reports unknown keys and bare words', () => {
    const msg = (raw: string) => `Unknown filter "${raw}". Use actor:, user:, action:, after: or before:.`;
    expect(parseAuditQuery('foo:bar').errors).toEqual([msg('foo:bar')]);
    expect(parseAuditQuery('hello').errors).toEqual([msg('hello')]);
    expect(parseAuditQuery('actor:').errors).toEqual([msg('actor:')]);
  });

  it('returns empty results for empty text', () => {
    expect(parseAuditQuery('  ')).toEqual({ filters: {}, tokens: [], errors: [] });
  });
});

describe('removeAuditQueryToken', () => {
  it('removes one token and collapses spaces', () => {
    expect(removeAuditQueryToken('actor:asir  user:sam action:x', 'user:sam')).toBe('actor:asir action:x');
    expect(removeAuditQueryToken('actor:asir', 'actor:asir')).toBe('');
  });
});

describe('setAuditQueryAction', () => {
  it('replaces the action token and keeps the others', () => {
    expect(setAuditQueryAction('actor:asir action:crew.*  user:sam', 'festival.*')).toBe(
      'actor:asir user:sam action:festival.*',
    );
    expect(setAuditQueryAction('', 'user.role.*')).toBe('action:user.role.*');
  });

  it('removes the action token for an empty prefix', () => {
    expect(setAuditQueryAction('action:crew.* actor:asir', '')).toBe('actor:asir');
  });
});

describe('describeAuditChanges', () => {
  it('describes strings, counts and arrays', () => {
    const rows = describeAuditChanges({
      changes: {
        name: ['Forbidden Kingdom', 'Forbidden Kingdom 2026'],
        sets: [10, 12],
        roles: [['user'], ['user', 'admin']],
        timeZone: [null, 'America/New_York'],
        custom: ['', []],
      },
    });
    expect(rows).toEqual([
      { field: 'name', label: 'Name', before: 'Forbidden Kingdom', after: 'Forbidden Kingdom 2026' },
      { field: 'sets', label: 'Sets', before: '10', after: '12' },
      { field: 'roles', label: 'Roles', before: 'user', after: 'user, admin' },
      { field: 'timeZone', label: 'Time zone', before: '(none)', after: 'America/New_York' },
      { field: 'custom', label: 'custom', before: '(none)', after: '(none)' },
    ]);
  });

  it('returns [] when changes is missing or not an object', () => {
    expect(describeAuditChanges(null)).toEqual([]);
    expect(describeAuditChanges({})).toEqual([]);
    expect(describeAuditChanges({ changes: 'x' })).toEqual([]);
    expect(describeAuditChanges({ changes: [1] })).toEqual([]);
  });
});

describe('auditEntriesToCsv', () => {
  const entry = {
    id: '1',
    action: 'festival.updated',
    actorUsername: 'asir',
    targetLabel: 'Big, "Fest"',
    targetType: 'festival',
    targetId: 'f1',
    status: 'success',
    createdAt: '2026-10-31T12:00:00.000Z',
    requestId: 'r1',
    ip: '1.2.3.4',
    userAgent: 'UA',
    details: { changes: { name: ['A', 'B'], sets: [1, 2] } },
  };

  it('writes a header, quotes cells and joins changes', () => {
    const lines = auditEntriesToCsv([entry]).split('\r\n');
    expect(lines[0]).toBe(
      'Time (UTC),Action,Description,By,Affects,Target type,Target ID,Status,Changes,Request ID',
    );
    expect(lines[1]).toBe(
      '2026-10-31T12:00:00.000Z,festival.updated,Festival updated,asir,"Big, ""Fest""",festival,f1,success,Name: A to B; Sets: 1 to 2,r1',
    );
  });

  it('guards formulas and never includes ip or user agent', () => {
    const csv = auditEntriesToCsv([{ ...entry, targetLabel: '=SUM(A1)', actorUsername: null }]);
    expect(csv).toContain(",System,'=SUM(A1),");
    expect(csv).not.toContain('1.2.3.4');
    expect(csv).not.toContain('UA');
    expect(csv.split('\r\n')[0]).not.toMatch(/\bip\b/i);
  });
});
