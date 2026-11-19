import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  alert: vi.fn(),
  showToast: vi.fn(),
  heavy: vi.fn(),
  setRaising: vi.fn(),
  raiseSos: vi.fn(),
  sosErrorMessage: vi.fn(),
  resolveSosPosition: vi.fn(),
}));

// No React renderer in this node harness: the hooks collapse to plain values so
// the hook body runs once and its returned callbacks can be called directly.
vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (v: unknown) => ({ current: v }),
  useState: (v: unknown) => [v, h.setRaising],
}));
vi.mock('react-native', () => ({ Alert: { alert: h.alert } }));
vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: vi.fn(),
  getLastKnownPositionAsync: vi.fn(),
  getCurrentPositionAsync: vi.fn(),
}));
vi.mock('@festie/shared/services', () => ({ raiseSos: h.raiseSos, sosErrorMessage: h.sosErrorMessage }));
vi.mock('@festie/shared/stores', () => ({ useUIStore: { getState: () => ({ showToast: h.showToast }) } }));
vi.mock('./sosPosition', () => ({ resolveSosPosition: h.resolveSosPosition }));
vi.mock('./useHaptics', () => ({ useHaptics: () => ({ heavy: h.heavy }) }));

const { useSosRaise } = await import('./useSosRaise');

const fix = { latitude: 1, longitude: 2, accuracy: 5 };
type Button = { text: string; style?: string; onPress?: () => void };
const sendButton = (call = 0): Button => (h.alert.mock.calls[call][2] as Button[]).find((b) => b.text === 'Send SOS')!;
const settled = () => vi.waitFor(() => expect(h.setRaising).toHaveBeenLastCalledWith(false));

beforeEach(() => {
  vi.clearAllMocks();
  h.raiseSos.mockResolvedValue(undefined);
  h.sosErrorMessage.mockReturnValue('send failed');
  h.resolveSosPosition.mockResolvedValue(fix);
});

describe('useSosRaise', () => {
  it('confirmRaise opens a destructive confirm and sends nothing until the user accepts', () => {
    useSosRaise('c1').confirmRaise();
    expect(h.alert).toHaveBeenCalledTimes(1);
    const buttons = h.alert.mock.calls[0][2] as Button[];
    expect(buttons.find((b) => b.text === 'Cancel')).toMatchObject({ style: 'cancel' });
    expect(sendButton()).toMatchObject({ style: 'destructive' });
    expect(h.raiseSos).not.toHaveBeenCalled();
  });

  it('does nothing without a crew', () => {
    useSosRaise(null).confirmRaise();
    expect(h.alert).not.toHaveBeenCalled();
    expect(h.raiseSos).not.toHaveBeenCalled();
  });

  it('raises with the resolved position, buzzes, and toasts success', async () => {
    useSosRaise('c1').confirmRaise();
    sendButton().onPress!();
    await settled();
    expect(h.heavy).toHaveBeenCalledTimes(1);
    expect(h.raiseSos).toHaveBeenCalledWith('c1', { position: fix });
    expect(h.showToast).toHaveBeenCalledWith('SOS sent to your crew', { kind: 'success' });
    expect(h.setRaising.mock.calls).toEqual([[true], [false]]);
  });

  it('still raises, without a position, and says so when no fix is available', async () => {
    h.resolveSosPosition.mockResolvedValue(undefined);
    useSosRaise('c1').confirmRaise();
    sendButton().onPress!();
    await settled();
    expect(h.raiseSos).toHaveBeenCalledWith('c1', {});
    expect(h.alert).toHaveBeenLastCalledWith('SOS sent without your location', expect.any(String));
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('still raises when location resolution throws', async () => {
    h.resolveSosPosition.mockRejectedValue(new Error('gps'));
    useSosRaise('c1').confirmRaise();
    sendButton().onPress!();
    await settled();
    expect(h.raiseSos).toHaveBeenCalledWith('c1', {});
  });

  it('surfaces a failed send and clears the raising flag', async () => {
    h.raiseSos.mockRejectedValue(new Error('offline'));
    useSosRaise('c1').confirmRaise();
    sendButton().onPress!();
    await settled();
    expect(h.sosErrorMessage).toHaveBeenCalledWith(expect.any(Error), 'send');
    expect(h.alert).toHaveBeenLastCalledWith('SOS not sent', 'send failed');
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it('ignores a second confirm while a raise is in flight, then allows another', async () => {
    let release!: () => void;
    h.raiseSos.mockReturnValue(new Promise<void>((r) => (release = r)));
    const { confirmRaise } = useSosRaise('c1');
    confirmRaise();
    confirmRaise();
    const first = sendButton(0);
    const second = sendButton(1);
    first.onPress!();
    second.onPress!();
    await vi.waitFor(() => expect(h.raiseSos).toHaveBeenCalledTimes(1));
    release();
    await settled();
    expect(h.raiseSos).toHaveBeenCalledTimes(1);
    h.raiseSos.mockResolvedValue(undefined);
    second.onPress!();
    await vi.waitFor(() => expect(h.raiseSos).toHaveBeenCalledTimes(2));
  });
});
