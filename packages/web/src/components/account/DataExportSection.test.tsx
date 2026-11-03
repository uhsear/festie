import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataExportSection from './DataExportSection';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { ApiClientError } from '@festie/shared/services/api';
import { DATA_COPY } from '@festie/shared/constants';

const mockToast = vi.fn();
vi.mock('../../lib/toastContext', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockDownload = vi.fn();
vi.mock('../../lib/downloadExport', () => ({
  downloadExport: () => mockDownload(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDownload.mockResolvedValue(undefined);
  useUIStore.setState({ offlineMode: false });
});

describe('DataExportSection', () => {
  it('renders the Download my data card', () => {
    render(<DataExportSection />);
    expect(screen.getByRole('heading', { name: DATA_COPY.title })).toBeInTheDocument();
    expect(screen.getByText(DATA_COPY.hint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DATA_COPY.button })).toBeInTheDocument();
  });

  it('downloads and toasts done', async () => {
    const user = userEvent.setup();
    render(<DataExportSection />);
    await user.click(screen.getByRole('button', { name: DATA_COPY.button }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(DATA_COPY.done, 'success'));
    expect(mockDownload).toHaveBeenCalledTimes(1);
  });

  it('toasts the limit text for a 429 with retryAfter', async () => {
    const user = userEvent.setup();
    mockDownload.mockRejectedValue(new ApiClientError('limit', 429, 'RATE_LIMITED', 3600));
    render(<DataExportSection />);
    await user.click(screen.getByRole('button', { name: DATA_COPY.button }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    const [msg, kind] = mockToast.mock.calls[0];
    expect(msg).toMatch(/^You can download your data once a day\. Try again (today|tomorrow) at /);
    expect(kind).toBe('error');
  });

  it('is disabled offline', () => {
    useUIStore.setState({ offlineMode: true });
    render(<DataExportSection />);
    expect(screen.getByRole('button', { name: DATA_COPY.button })).toBeDisabled();
  });
});
