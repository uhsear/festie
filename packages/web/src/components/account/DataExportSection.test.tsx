import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataExportSection from './DataExportSection';

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockApiGet = vi.fn();
vi.mock('@festie/shared/services/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
  mapErrorToUserMessage: (_err: unknown, fallback: string) => fallback,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockApiGet.mockResolvedValue({ profile: {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('DataExportSection', () => {
  it('renders the Export Data section', () => {
    render(<DataExportSection />);
    expect(screen.getByText('Export Data')).toBeInTheDocument();
    expect(screen.getByText('Download My Data')).toBeInTheDocument();
  });

  it('triggers data export download on click', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const anchor = { href: '', download: '', click: clickSpy } as unknown as HTMLElement;
        return anchor;
      }
      return document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
    });

    render(<DataExportSection />);
    await user.click(screen.getByText('Download My Data'));

    await waitFor(() => {
      expect(clickSpy).toHaveBeenCalled();
    });
    expect(mockToast).toHaveBeenCalledWith('Export downloaded', 'success');
  });

  it('shows error toast when export fails', async () => {
    const user = userEvent.setup();
    mockApiGet.mockRejectedValue(new Error('boom'));

    render(<DataExportSection />);
    await user.click(screen.getByText('Download My Data'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith("Couldn't export data. Try again.", 'error');
    });
  });
});
