import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiClientError } from '../api';
import { publishFestival, issuesFromError, checklistFromError } from '../festivalAdmin';

afterEach(() => vi.unstubAllGlobals());

describe('publishFestival', () => {
  it('posts to the publish route', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({ data: { publishedAt: 'now', checklist: [] }, error: null }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(publishFestival('x')).resolves.toEqual({ publishedAt: 'now', checklist: [] });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/admin/festivals/x/publish');
    expect(init.method).toBe('POST');
  });
});

describe('error readers', () => {
  const issue = { code: 'name_required', message: 'Name is required', target: { kind: 'festival', field: 'name' } };
  const checklist = [{ key: 'stages', status: 'todo', label: 'Add at least one stage.' }];

  it('issuesFromError reads details.issues', () => {
    const err = new ApiClientError('bad', 400, 'INVALID_INPUT', null, false, { issues: [issue] });
    expect(issuesFromError(err)).toEqual([issue]);
    expect(issuesFromError(new Error('x'))).toEqual([]);
    expect(issuesFromError(new ApiClientError('bad', 400))).toEqual([]);
  });

  it('checklistFromError only answers PUBLISH_BLOCKED', () => {
    const blocked = new ApiClientError('no', 409, 'PUBLISH_BLOCKED', null, false, { checklist });
    const other = new ApiClientError('no', 409, 'CONFLICT', null, false, { checklist });
    expect(checklistFromError(blocked)).toEqual(checklist);
    expect(checklistFromError(other)).toBeNull();
    expect(checklistFromError('x')).toBeNull();
  });
});
