import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Toast from './Toast';
import { ApiClientError } from '@festie/shared/services/api';

// Test Toast in isolation by mocking useToast
vi.mock('../../lib/toastContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/toastContext')>();
  return {
    ...actual,
    useToast: vi.fn(),
  };
});

import { useToast, ToastProvider } from '../../lib/toastContext';
const realUseToast = (await vi.importActual<typeof import('../../lib/toastContext')>('../../lib/toastContext'))
  .useToast;
const mockUseToast = vi.mocked(useToast);

function setupMockToast(
  toasts: Array<{
    id: string;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
    onUndo?: () => void;
  }>,
) {
  mockUseToast.mockReturnValue({
    toasts,
    toast: vi.fn(),
    toastUndo: vi.fn(),
    toastError: vi.fn(),
    removeToast: vi.fn(),
    pauseToast: vi.fn(),
    resumeToast: vi.fn(),
  });
}

describe('Toast', () => {
  it('renders no toast items when there are no toasts', () => {
    setupMockToast([]);
    render(<Toast />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['success', 'error', 'warning', 'info'] as const)(
    'renders a %s toast without a live role (the provider announces it)',
    (type) => {
      setupMockToast([{ id: '1', message: 'Hello', type }]);
      render(<Toast />);
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('renders multiple toasts', () => {
    setupMockToast([
      { id: '1', message: 'First', type: 'success' },
      { id: '2', message: 'Second', type: 'error' },
    ]);
    render(<Toast />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
  });

  it('calls removeToast when close button is clicked', async () => {
    const removeMock = vi.fn();
    mockUseToast.mockReturnValue({
      toasts: [{ id: 'toast-1', message: 'Bye', type: 'info' }],
      toast: vi.fn(),
      toastUndo: vi.fn(),
      toastError: vi.fn(),
      removeToast: removeMock,
      pauseToast: vi.fn(),
      resumeToast: vi.fn(),
    });
    const user = userEvent.setup();
    render(<Toast />);
    await user.click(screen.getByLabelText('Close'));
    expect(removeMock).toHaveBeenCalledWith('toast-1');
  });

  it('shows Undo button when onUndo is provided', () => {
    setupMockToast([{ id: '1', message: 'Deleted', type: 'info', onUndo: vi.fn() }]);
    render(<Toast />);
    expect(screen.getByText('Undo')).toBeInTheDocument();
  });

  it('does not show Undo button when onUndo is not provided', () => {
    setupMockToast([{ id: '1', message: 'Info', type: 'info' }]);
    render(<Toast />);
    expect(screen.queryByText('Undo')).not.toBeInTheDocument();
  });

  it('calls onUndo when Undo button is clicked', async () => {
    const undoFn = vi.fn();
    setupMockToast([{ id: '1', message: 'Removed', type: 'info', onUndo: undoFn }]);
    const user = userEvent.setup();
    render(<Toast />);
    await user.click(screen.getByText('Undo'));
    expect(undoFn).toHaveBeenCalledOnce();
  });

  it('styles Undo as a full-opacity 14px control', () => {
    setupMockToast([{ id: '1', message: 'Removed', type: 'info', onUndo: vi.fn() }]);
    render(<Toast />);
    const cls = screen.getByRole('button', { name: 'Undo: Removed' }).className;
    expect(cls).not.toContain('opacity-75');
    expect(cls).toContain('text-sm');
  });

  it('closes the toast when Undo is tapped', async () => {
    setupMockToast([{ id: 'u1', message: 'Removed', type: 'info', onUndo: vi.fn() }]);
    const user = userEvent.setup();
    render(<Toast />);
    await user.click(screen.getByText('Undo'));
    expect(mockUseToast().removeToast).toHaveBeenCalledWith('u1');
  });

  it('pauses a plain toast on hover but not an undo toast (its action timer keeps running)', async () => {
    setupMockToast([
      { id: 'p1', message: 'Saved', type: 'success' },
      { id: 'u1', message: 'Removed', type: 'info', onUndo: vi.fn() },
    ]);
    const user = userEvent.setup();
    render(<Toast />);
    await user.hover(screen.getByText('Saved'));
    expect(mockUseToast().pauseToast).toHaveBeenCalledWith('p1');
    await user.hover(screen.getByText('Removed'));
    expect(mockUseToast().pauseToast).not.toHaveBeenCalledWith('u1');
  });

  it('is not itself a live region, so only the provider regions announce', () => {
    setupMockToast([{ id: '1', message: 'Saved!', type: 'success' }]);
    const { container } = render(<Toast />);
    expect(container.querySelector('[aria-live]')).toBeNull();
    expect(container.querySelector('[role]')).toBeNull();
  });

  it('hides the close icon from assistive tech and drops the solid-white hover', () => {
    setupMockToast([{ id: '1', message: 'Hi', type: 'info' }]);
    render(<Toast />);
    const close = screen.getByLabelText('Close');
    expect(close.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(close.className).not.toContain('bg-opacity');
  });

  it('colours error text with the danger token', () => {
    setupMockToast([{ id: '1', message: 'Failed', type: 'error' }]);
    render(<Toast />);
    expect(screen.getByText('Failed').closest('.glass')?.className).toContain('text-[var(--color-text-danger)]');
  });
});

describe('toastError', () => {
  function Probe({ err }: { err: unknown }) {
    const { toasts, toastError } = realUseToast();
    return (
      <div>
        <button onClick={() => toastError(err, 'Fallback')}>go</button>
        {toasts.map((t) => (
          <p key={t.id}>{t.message}</p>
        ))}
      </div>
    );
  }

  it('shows the error message for a plain Error', async () => {
    render(
      <ToastProvider>
        <Probe err={new Error('x')} />
      </ToastProvider>,
    );
    await userEvent.setup().click(screen.getByText('go'));
    expect(screen.getByText('x', { selector: 'p' })).toBeInTheDocument();
  });

  it('shows the friendly 429 copy', async () => {
    render(
      <ToastProvider>
        <Probe err={new ApiClientError('Too many requests', 429, undefined, 30)} />
      </ToastProvider>,
    );
    await userEvent.setup().click(screen.getByText('go'));
    expect(screen.getByText('Too many tries. Wait 30 seconds and try again.', { selector: 'p' })).toBeInTheDocument();
  });
});

describe('ToastProvider live regions', () => {
  beforeEach(() => {
    mockUseToast.mockImplementation(realUseToast);
  });

  function Caller() {
    const { toast, toastUndo, toastError } = realUseToast();
    return (
      <div>
        <button onClick={() => toast('Saved!', 'success')}>success</button>
        <button onClick={() => toast('Failed', 'error')}>error</button>
        <button onClick={() => toast('Careful', 'warning')}>warning</button>
        <button onClick={() => toastUndo('Removed', () => {})}>undo</button>
        <button onClick={() => toastError(new Error('Boom'), 'Fallback')}>toastError</button>
      </div>
    );
  }

  function renderProvider() {
    render(
      <ToastProvider>
        <Caller />
        <Toast />
      </ToastProvider>,
    );
    return {
      polite: screen.getByTestId('toast-live-polite'),
      assertive: screen.getByTestId('toast-live-assertive'),
    };
  }

  it('mounts empty polite and assertive regions before any toast', () => {
    const { polite, assertive } = renderProvider();
    expect(polite).toHaveAttribute('aria-live', 'polite');
    expect(polite).toBeEmptyDOMElement();
    expect(assertive).toHaveAttribute('aria-live', 'assertive');
    expect(assertive).toBeEmptyDOMElement();
  });

  it('writes non-alert toasts to the polite region only', async () => {
    const { polite, assertive } = renderProvider();
    await userEvent.setup().click(screen.getByText('success'));
    await waitFor(() => expect(polite).toHaveTextContent('Saved!'));
    expect(assertive).toBeEmptyDOMElement();
  });

  it.each([
    ['error', 'Failed'],
    ['warning', 'Careful'],
  ])('writes a %s toast to the assertive region only', async (label, message) => {
    const { polite, assertive } = renderProvider();
    await userEvent.setup().click(screen.getByText(label));
    await waitFor(() => expect(assertive).toHaveTextContent(message));
    expect(polite).toBeEmptyDOMElement();
  });

  it('announces toastUndo politely and keeps Undo reachable by keyboard', async () => {
    const { polite } = renderProvider();
    const user = userEvent.setup();
    await user.click(screen.getByText('undo'));
    await waitFor(() => expect(polite).toHaveTextContent('Removed'));
    const undo = screen.getByRole('button', { name: 'Undo: Removed' });
    for (let i = 0; i < 10 && document.activeElement !== undo; i++) await user.tab();
    expect(undo).toHaveFocus();
  });

  it('announces toastError assertively', async () => {
    const { assertive } = renderProvider();
    await userEvent.setup().click(screen.getByText('toastError'));
    await waitFor(() => expect(assertive).toHaveTextContent('Boom'));
  });

  it('re-announces an identical message by clearing before setting', async () => {
    const { polite } = renderProvider();
    const user = userEvent.setup();
    await user.click(screen.getByText('success'));
    await waitFor(() => expect(polite).toHaveTextContent('Saved!'));
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(polite.textContent ?? ''));
    observer.observe(polite, { childList: true, characterData: true, subtree: true });
    await user.click(screen.getByText('success'));
    await waitFor(() => expect(seen).toContain('Saved!'));
    observer.disconnect();
    expect(seen[0]).toBe('');
  });
});
