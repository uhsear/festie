import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeFile = {
  parent: unknown;
  name: string;
  uri: string;
  create: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
};

const h = vi.hoisted(() => ({
  files: [] as unknown[],
  fetchAccountExport: vi.fn(),
  isAvailableAsync: vi.fn(),
  shareAsync: vi.fn(),
  alert: vi.fn(),
}));

vi.mock('react-native', () => ({ Alert: { alert: h.alert } }));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'CACHE' },
  File: class {
    uri: string;
    create = vi.fn();
    write = vi.fn();
    constructor(
      public parent: unknown,
      public name: string,
    ) {
      this.uri = `file:///cache/${name}`;
      h.files.push(this);
    }
  },
}));
vi.mock('expo-sharing', () => ({ isAvailableAsync: h.isAvailableAsync, shareAsync: h.shareAsync }));
vi.mock('@festie/shared/constants', () => ({ DATA_COPY: { shareTitle: 'Share title', done: 'Done' } }));
vi.mock('@festie/shared/services', () => ({ fetchAccountExport: h.fetchAccountExport }));

const { shareAccountExport } = await import('./exportData');

beforeEach(() => {
  vi.clearAllMocks();
  h.files.length = 0;
  h.fetchAccountExport.mockResolvedValue({ user: { id: 'u1' } });
});

describe('shareAccountExport', () => {
  it('overwrites one fixed cache file with the pretty-printed export', async () => {
    h.isAvailableAsync.mockResolvedValue(true);
    await shareAccountExport();
    expect(h.files).toHaveLength(1);
    const file = h.files[0] as FakeFile;
    expect(file.parent).toBe('CACHE');
    expect(file.name).toBe('festie-data-export.json');
    expect(file.create).toHaveBeenCalledWith({ overwrite: true });
    expect(file.write).toHaveBeenCalledWith(JSON.stringify({ user: { id: 'u1' } }, null, 2));
  });

  it('opens the share sheet with the JSON mime type when sharing is available', async () => {
    h.isAvailableAsync.mockResolvedValue(true);
    await shareAccountExport();
    expect(h.shareAsync).toHaveBeenCalledWith('file:///cache/festie-data-export.json', {
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'Share title',
    });
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('shows the file location in an alert when sharing is unavailable', async () => {
    h.isAvailableAsync.mockResolvedValue(false);
    await shareAccountExport();
    expect(h.alert).toHaveBeenCalledWith('Done', 'file:///cache/festie-data-export.json');
    expect(h.shareAsync).not.toHaveBeenCalled();
  });

  it('propagates a fetch failure without writing a file', async () => {
    h.fetchAccountExport.mockRejectedValue(new Error('offline'));
    await expect(shareAccountExport()).rejects.toThrow('offline');
    expect(h.files).toHaveLength(0);
    expect(h.shareAsync).not.toHaveBeenCalled();
  });
});
