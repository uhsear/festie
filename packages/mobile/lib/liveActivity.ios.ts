import Constants from 'expo-constants';

export interface LiveActivityContent {
  title: string;
  body: string;
  endsAt?: string | null;
}

// app.config.js sets extra.liveActivity only for builds made with FESTIE_LIVE_ACTIVITY=1, the same
// builds that carry the widget extension. The widget module loads lazily, after this check, so a
// build without the extension never touches it.
const enabled = () => Constants.expoConfig?.extra?.liveActivity === true;
const loadWidgets = () => import('../widgets/NowNextActivity.ios');

/** Start one Live Activity, or update the surviving instance after relaunch. */
export async function startOrUpdateLiveActivity(content: LiveActivityContent): Promise<void> {
  if (!enabled()) return;
  try {
    const { NowNextActivityFactory } = await loadWidgets();
    const props = {
      title: content.title,
      subtitle: content.body,
      endsAt: content.endsAt ?? null,
    };
    const existing = NowNextActivityFactory.getInstances();
    if (existing.length > 0) {
      // Recover one survivor after relaunch and self-heal any duplicates left
      // by a prior interrupted start.
      await existing[0]!.update(props);
      await Promise.all(existing.slice(1).map((activity) => activity.end('immediate')));
    } else {
      NowNextActivityFactory.start(props, 'festie://festival-mode');
    }
  } catch {
    // Glanceable status must never make the main app fail.
  }
}

/** End every recovered instance so relaunches cannot leave stale activities. */
export async function endLiveActivity(): Promise<void> {
  if (!enabled()) return;
  try {
    const { NowNextActivityFactory } = await loadWidgets();
    await Promise.all(NowNextActivityFactory.getInstances().map((activity) => activity.end('immediate')));
  } catch {
    /* no-op */
  }
}

/** Push the same model to the home-screen widget timeline. */
export async function updateWidgetSnapshot(content: LiveActivityContent): Promise<void> {
  if (!enabled()) return;
  try {
    const { NowNextWidgetInstance } = await loadWidgets();
    NowNextWidgetInstance.updateSnapshot({ title: content.title, subtitle: content.body, endsAt: content.endsAt ?? null });
  } catch {
    // Never let a widget-timeline failure surface to the user.
  }
}

// expo-widgets has no clearSnapshot/reset API (Widget only exposes
// updateSnapshot/updateTimeline/reload) — the least-surprise way to un-stick a
// stale "Now: X" on the home-screen widget is to push a neutral placeholder.
export function clearWidgetSnapshot(): Promise<void> {
  return updateWidgetSnapshot({ title: 'Festie', body: 'Open the app to plan your sets' });
}
