import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOtaUpdatePrompt } from './useOtaUpdatePrompt';

const updates = vi.hoisted(() => ({
  isUpdatePending: false,
  reloadAsync: vi.fn(() => Promise.resolve()),
  checkForUpdateAsync: vi.fn(() => Promise.resolve({ isAvailable: false })),
  fetchUpdateAsync: vi.fn(() => Promise.resolve()),
}));
const alert = vi.hoisted(() => vi.fn());
const appState = vi.hoisted(() => ({ handler: null as null | ((s: string) => void) }));

vi.mock('expo-updates', () => ({
  useUpdates: () => ({ isUpdatePending: updates.isUpdatePending }),
  isEnabled: true,
  reloadAsync: updates.reloadAsync,
  checkForUpdateAsync: updates.checkForUpdateAsync,
  fetchUpdateAsync: updates.fetchUpdateAsync,
}));
vi.mock('react-native', () => ({
  Alert: { alert },
  AppState: {
    addEventListener: (_type: string, handler: (s: string) => void) => {
      appState.handler = handler;
      return { remove: () => {} };
    },
  },
}));
// The hook runs outside a renderer: refs are plain objects and effects run inline, once.
vi.mock('react', () => ({
  useRef: <T,>(current: T) => ({ current }),
  useEffect: (fn: () => void) => void fn(),
}));

const useRender = () => useOtaUpdatePrompt();

beforeEach(() => {
  vi.clearAllMocks();
  updates.isUpdatePending = false;
  appState.handler = null;
});

describe('useOtaUpdatePrompt', () => {
  it('shows no prompt while no update is ready', () => {
    expect(useRender().updateReady).toBe(false);
    expect(alert).not.toHaveBeenCalled();
  });

  it('prompts when an update is ready, and "Restart now" reloads the app', () => {
    updates.isUpdatePending = true;
    expect(useRender().updateReady).toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
    expect(title).toBe('Update ready');
    buttons.find((b) => b.text === 'Restart now')!.onPress!();
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('checks for an update when the app returns to the foreground and fetches one that is available', async () => {
    updates.checkForUpdateAsync.mockResolvedValueOnce({ isAvailable: true });
    useRender();
    appState.handler!('active');
    await vi.waitFor(() => expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1));
    expect(updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
  });
});
