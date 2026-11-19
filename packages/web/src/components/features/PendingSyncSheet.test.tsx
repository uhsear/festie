import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PendingSyncSheet from './PendingSyncSheet';
import type { OfflineQueueBridge } from '@festie/shared/services';
import { OfflineQueueContext } from '../../hooks/useOfflineQueueBridge';
import { useUIStore } from '@festie/shared/stores/uiStore';
import type { FailedSyncItem } from '@festie/shared/stores/uiStore';

const dismissFailedSync = vi.fn();
const clearFailedSync = vi.fn();
const { dismissFailed, clearPersistedFailed } = vi.hoisted(() => ({
  dismissFailed: vi.fn(),
  clearPersistedFailed: vi.fn(),
}));

vi.mock('@festie/shared/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@festie/shared/services')>()),
  dismissFailed,
  clearPersistedFailed,
}));

interface MockState {
  failedSync: FailedSyncItem[];
  dismissFailedSync: typeof dismissFailedSync;
  clearFailedSync: typeof clearFailedSync;
}

vi.mock('@festie/shared/stores/uiStore', () => {
  const mockStore = vi.fn();
  (mockStore as unknown as { getState: () => unknown }).getState = () => ({
    dismissFailedSync,
    clearFailedSync,
  });
  return { useUIStore: mockStore };
});

function setStoreState(failedSync: FailedSyncItem[]) {
  const state: MockState = { failedSync, dismissFailedSync, clearFailedSync };
  vi.mocked(useUIStore).mockImplementation((selector: (s: typeof state) => unknown) => selector(state) as never);
  (useUIStore as unknown as { getState: () => unknown }).getState = () => state;
}

function item(overrides: Partial<FailedSyncItem> = {}): FailedSyncItem {
  return {
    clientId: 'c1',
    label: 'Add poll',
    method: 'POST',
    url: '/crews/x/polls',
    body: { question: 'pizza?' },
    error: 'Conflict',
    at: Date.now(),
    ...overrides,
  };
}

// jsdom has no pointer capture; vaul calls it on pointerdown inside the sheet.
beforeAll(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

function renderWithQueue(ui: React.ReactElement, queue: OfflineQueueBridge) {
  return render(<OfflineQueueContext.Provider value={queue}>{ui}</OfflineQueueContext.Provider>);
}

describe('PendingSyncSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dismissFailed.mockResolvedValue(undefined);
    clearPersistedFailed.mockResolvedValue(undefined);
  });

  it('renders nothing and closes when there are no failed items', () => {
    const onClose = vi.fn();
    setStoreState([]);
    const { container } = render(<PendingSyncSheet onClose={onClose} />);
    expect(container.firstChild).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('lists each failed item with its label and error', () => {
    setStoreState([item({ label: 'Add meeting point', error: 'Conflict' })]);
    render(<PendingSyncSheet onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Add meeting point')).toBeInTheDocument();
    expect(screen.getByText('Conflict')).toBeInTheDocument();
  });

  it('dismisses a single item from the store and storage via its Dismiss button', async () => {
    const user = userEvent.setup();
    setStoreState([item({ clientId: 'abc' })]);
    render(<PendingSyncSheet onClose={vi.fn()} />);
    await user.click(screen.getByText('Dismiss'));
    expect(dismissFailed).toHaveBeenCalledWith('abc');
  });

  it('re-enqueues via the offline queue context on Retry', async () => {
    const user = userEvent.setup();
    const queueMutation = vi.fn().mockResolvedValue('abc');
    const processQueue = vi.fn().mockResolvedValue(undefined);
    setStoreState([item({ clientId: 'abc', url: '/crews/x/polls', method: 'POST' })]);
    renderWithQueue(<PendingSyncSheet onClose={vi.fn()} />, { queueMutation, processQueue });
    await user.click(screen.getByText('Retry'));
    expect(queueMutation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'api', clientId: 'abc', url: '/crews/x/polls', method: 'POST' }),
    );
    // It optimistically drops the item from the failed list and from storage.
    expect(dismissFailed).toHaveBeenCalledWith('abc');
  });

  it('clears all items via Dismiss all', async () => {
    const user = userEvent.setup();
    setStoreState([item({ clientId: 'a' }), item({ clientId: 'b' })]);
    render(<PendingSyncSheet onClose={vi.fn()} />);
    await user.click(screen.getByText('Dismiss all'));
    expect(clearFailedSync).toHaveBeenCalled();
    expect(clearPersistedFailed).toHaveBeenCalled();
  });

  it('keeps the sheet open while Retry all is in flight, even once the list empties', async () => {
    const user = userEvent.setup();
    const finishers: Array<() => void> = [];
    const processQueue = vi.fn(() => new Promise<void>((resolve) => finishers.push(resolve)));
    const queue = { queueMutation: vi.fn().mockResolvedValue('a'), processQueue };
    const onClose = vi.fn();
    setStoreState([item({ clientId: 'a' }), item({ clientId: 'b' })]);
    const { rerender } = renderWithQueue(<PendingSyncSheet onClose={onClose} />, queue);
    await user.click(screen.getByText('Retry all'));
    setStoreState([]);
    rerender(<OfflineQueueContext.Provider value={queue}><PendingSyncSheet onClose={onClose} /></OfflineQueueContext.Provider>);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finishers.forEach((f) => f()));
    expect(onClose).toHaveBeenCalled();
  });
});
