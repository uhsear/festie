import { describe, it, expect, vi, beforeEach } from 'vitest';

const { post, get } = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('../api', () => ({ api: { post, get } }));

import { lineupImportApi } from '../lineupImport';

const body = { rows: [], updateExisting: false, createMissing: true, skipSpotify: false };

describe('lineupImportApi', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
  });

  it('preview posts to the preview path', async () => {
    await lineupImportApi.preview('f 1', body);
    expect(post).toHaveBeenCalledWith('/admin/festivals/f%201/import-lineup/preview', body);
  });

  it('commit uses a 120 s timeout', async () => {
    await lineupImportApi.commit('f1', body);
    expect(post).toHaveBeenCalledWith('/admin/festivals/f1/import-lineup', body, { timeoutMs: 120_000 });
  });

  it('history, undo and announcement hit the contract paths', async () => {
    await lineupImportApi.history('f1');
    expect(get).toHaveBeenCalledWith('/admin/festivals/f1/imports');
    await lineupImportApi.undo('f1', 'i1');
    expect(post).toHaveBeenCalledWith('/admin/festivals/f1/imports/i1/undo');
    await lineupImportApi.announcement('f1');
    expect(get).toHaveBeenCalledWith('/admin/festivals/f1/lineup-announcement');
    await lineupImportApi.announce('f1');
    expect(post).toHaveBeenCalledWith('/admin/festivals/f1/lineup-announcement');
  });

  it('exportCsv reads the festival and writes the export columns', async () => {
    get.mockResolvedValue({ stages: [], days: [{ label: 'Fri', sets: [{ id: 's1', artist: 'Kai', startTime: '20:00' }] }] });
    const csv = await lineupImportApi.exportCsv('f 1');
    expect(get).toHaveBeenCalledWith('/admin/festivals/f%201');
    expect(csv.split(/\r?\n/)).toEqual(['set_id,day,stage,artist,start,end', 's1,Fri,,Kai,20:00,']);
  });
});
