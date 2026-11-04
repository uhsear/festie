import { StyleSheet, Text, View } from 'react-native';

export type LockscreenClock = 'normal' | 'big' | 'widgets';

/**
 * Where the phone's own lock-screen parts sit, as fractions of screen height (and width for
 * the corner buttons). Estimates from the geometry research, not device measurements.
 */
export const LOCK_CHROME = {
  date: { top: 0.075, bottom: 0.095 },
  clockTop: 0.1,
  clockBottom: { normal: 0.27, big: 0.4, widgets: 0.38 },
  widgets: { top: 0.4, bottom: 0.48 },
  button: { centerY: 0.921, size: 0.127, centerX: [0.18, 0.82] },
  homeBar: { y: 0.983, width: 0.36 },
} as const;

/**
 * A see-through sketch of the clock, widgets and corner buttons drawn over the preview so the
 * user sees what the phone will cover. It is never part of the saved image.
 */
export default function LockscreenOverlay({
  width,
  height,
  clock,
}: {
  width: number;
  height: number;
  clock: LockscreenClock;
}) {
  const clockTop = LOCK_CHROME.clockTop * height;
  const clockH = (LOCK_CHROME.clockBottom[clock] - LOCK_CHROME.clockTop) * height;
  const button = LOCK_CHROME.button.size * width;
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} pointerEvents="none">
      <Text
        style={[styles.ink, { top: LOCK_CHROME.date.top * height, fontSize: Math.max(6, 0.018 * height) }]}
        allowFontScaling={false}
      >
        Friday 6
      </Text>
      <Text
        style={[styles.ink, styles.clock, { top: clockTop, height: clockH, fontSize: clockH * 0.82, lineHeight: clockH }]}
        allowFontScaling={false}
      >
        9:41
      </Text>
      {clock === 'widgets' ? (
        <View
          style={[
            styles.widgetRow,
            { top: LOCK_CHROME.widgets.top * height, height: (LOCK_CHROME.widgets.bottom - LOCK_CHROME.widgets.top) * height },
          ]}
        >
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.widget, { borderRadius: width * 0.04 }]} />
          ))}
        </View>
      ) : null}
      {LOCK_CHROME.button.centerX.map((x) => (
        <View
          key={x}
          style={[
            styles.button,
            {
              width: button,
              height: button,
              borderRadius: button / 2,
              left: x * width - button / 2,
              top: LOCK_CHROME.button.centerY * height - button / 2,
            },
          ]}
        />
      ))}
      <View
        style={[
          styles.homeBar,
          {
            top: LOCK_CHROME.homeBar.y * height,
            left: ((1 - LOCK_CHROME.homeBar.width) / 2) * width,
            width: LOCK_CHROME.homeBar.width * width,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  ink: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  clock: { fontWeight: '700' },
  widgetRow: { position: 'absolute', left: '10%', right: '10%', flexDirection: 'row', gap: 6 },
  widget: { flex: 1, backgroundColor: 'rgba(255,255,255,0.22)' },
  button: { position: 'absolute', backgroundColor: 'rgba(90,90,90,0.55)' },
  homeBar: { position: 'absolute', height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.85)' },
});
