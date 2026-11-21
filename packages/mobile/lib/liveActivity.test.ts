import { beforeEach, describe, expect, it, vi } from 'vitest';

const extra = vi.hoisted(() => ({ liveActivity: true }));
const instance = vi.hoisted(() => ({ update: vi.fn(), end: vi.fn() }));
const factory = vi.hoisted(() => ({ start: vi.fn(), getInstances: vi.fn() }));
const widget = vi.hoisted(() => ({ updateSnapshot: vi.fn() }));

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra } } }));
vi.mock('../widgets/NowNextActivity.ios', () => {
  return { NowNextActivityFactory: factory, NowNextWidgetInstance: widget };
});

const content = { title: 'Now: A', body: 'Main Stage', endsAt: '2026-07-01T02:00:00.000Z' };

beforeEach(() => {
  vi.clearAllMocks();
  extra.liveActivity = true;
  factory.getInstances.mockReturnValue([]);
});

describe('Live Activity flag', () => {
  it('never starts or updates while the flag is off', async () => {
    extra.liveActivity = false;
    factory.getInstances.mockReturnValue([instance]);
    const mod = await import('./liveActivity.ios');
    await mod.startOrUpdateLiveActivity(content);
    await mod.updateWidgetSnapshot(content);
    expect(factory.start).not.toHaveBeenCalled();
    expect(instance.update).not.toHaveBeenCalled();
    expect(widget.updateSnapshot).not.toHaveBeenCalled();
  });

  it('still ends survivors and clears the snapshot while the flag is off', async () => {
    extra.liveActivity = false;
    factory.getInstances.mockReturnValue([instance]);
    const mod = await import('./liveActivity.ios');
    await mod.endLiveActivity();
    await mod.clearWidgetSnapshot();
    expect(instance.end).toHaveBeenCalledWith('immediate');
    expect(widget.updateSnapshot).toHaveBeenCalledWith({
      title: 'Festie',
      subtitle: 'Open the app to plan your sets',
      endsAt: null,
    });
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
