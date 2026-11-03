import { describe, it, expect, vi, beforeEach } from 'vitest';
import { downloadExport } from './downloadExport';

const mockFetch = vi.fn();
vi.mock('@festie/shared/services/account', () => ({
  fetchAccountExport: () => mockFetch(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ profile: {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('downloadExport', () => {
  it('saves a dated file with one click and one revoke', async () => {
    let name = '';
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        name = this.download;
      });
    await downloadExport();
    expect(name).toMatch(/^festie-export-\d{4}-\d{2}-\d{2}\.json$/);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('propagates errors', async () => {
    mockFetch.mockRejectedValue(new Error('boom'));
    await expect(downloadExport()).rejects.toThrow('boom');
  });
});
