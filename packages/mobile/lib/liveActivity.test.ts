import { beforeEach, describe, expect, it, vi } from 'vitest';

const extra = vi.hoisted(() => ({ liveActivity: true }));
const instance = vi.hoisted(() => ({ update: vi.fn(), end: vi.fn() }));
const factory = vi.hoisted(() => ({ start: vi.fn(), getInstances: vi.fn() }));
const widget = vi.hoisted(() => ({ updateSnapshot: vi.fn() }));
const loaded = vi.hoisted(() => ({ count: 0 }));

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra } } }));
vi.mock('../widgets/NowNextActivity.ios', () => {
  loaded.count += 1;
  return { NowNextActivityFactory: factory, NowNextWidgetInstance: widget };
});

const content = { title: 'Now: A', body: 'Main Stage', endsAt: '2026-07-01T02:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  extra.liveActivity = true;
  factory.getInstances.mockReturnValue([]);
});

describe('Live Activity flag', () => {
  it('never loads the widget module while the flag is off', async () => {
    extra.liveActivity = false;
    vi.resetModules();
    loaded.count = 0;
    const mod = await import('./liveActivity.ios');
    await mod.startOrUpdateLiveActivity(content);
    await mod.endLiveActivity();
    await mod.updateWidgetSnapshot(content);
    await mod.clearWidgetSnapshot();
    expect(loaded.count).toBe(0);
    expect(factory.start).not.toHaveBeenCalled();
    expect(widget.updateSnapshot).not.toHaveBeenCalled();
  });

  it('starts one activity when none survived a relaunch', async () => {
    const mod = await import('./liveActivity.ios');
    await mod.startOrUpdateLiveActivity(content);
    expect(factory.start).toHaveBeenCalledWith(
      { title: 'Now: A', subtitle: 'Main Stage', endsAt: content.endsAt },
      'festie://festival-mode',
    );
  });

  it('updates the survivor and ends duplicates', async () => {
    const dup = { update: vi.fn(), end: vi.fn() };
    factory.getInstances.mockReturnValue([instance, dup]);
    const mod = await import('./liveActivity.ios');
    await mod.startOrUpdateLiveActivity(content);
    expect(instance.update).toHaveBeenCalledOnce();
    expect(dup.end).toHaveBeenCalledWith('immediate');
    expect(factory.start).not.toHaveBeenCalled();
  });

  it('pushes the widget snapshot and a neutral placeholder on clear', async () => {
    const mod = await import('./liveActivity.ios');
    await mod.updateWidgetSnapshot(content);
    expect(widget.updateSnapshot).toHaveBeenLastCalledWith({ title: 'Now: A', subtitle: 'Main Stage', endsAt: content.endsAt });
    await mod.clearWidgetSnapshot();
    expect(widget.updateSnapshot).toHaveBeenLastCalledWith({
      title: 'Festie',
      subtitle: 'Open the app to plan your sets',
      endsAt: null,
    });
  });

  it('swallows native failures', async () => {
    factory.getInstances.mockImplementation(() => {
      throw new Error('native');
    });
    const mod = await import('./liveActivity.ios');
    await expect(mod.startOrUpdateLiveActivity(content)).resolves.toBeUndefined();
    await expect(mod.endLiveActivity()).resolves.toBeUndefined();
  });
});
