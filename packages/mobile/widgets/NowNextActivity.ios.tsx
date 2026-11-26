import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  activityBackgroundTint,
  containerBackground,
  font,
  foregroundStyle,
  lineLimit,
  monospacedDigit,
  opacity,
  padding,
  preferredColorScheme,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, createWidget, type LiveActivityEnvironment, type WidgetEnvironment } from 'expo-widgets';

/**
 * Festie "Now & Next" iOS Live Activity + Home-Screen Widget (expo-widgets).
 *
 * Both surfaces present the same on-device model that powers the Android ongoing
 * notification (`buildOngoingNotificationModel` -> { title, body }).
 *
 * Live Activity: Lock Screen banner + Dynamic Island, driven from JS via
 * lib/liveActivity.ts (start/update/end).
 *
 * Home-screen widget: systemSmall (2x2) and systemMedium (4x2) layouts compiled
 * to SwiftUI by expo-widgets at build time. Timeline is kept current by
 * hooks/useOngoingNotification.ts calling NowNextWidget.updateSnapshot() whenever
 * the model changes, the same rhythm as the Live Activity update.
 *
 * Design (DP-69): one lead object per state, as on the in-app Now & Next surface.
 * Now: the set name leads, marked by a live-green dot and the word NOW (shape plus
 * word, never colour alone). Next: the native countdown timer leads and the set name
 * follows. Ground is black with white text in both system schemes (Stage). The only
 * accent is the live token; coral stays reserved for danger/SOS.
 *
 * Isolated runtime: 'widget' functions cannot read module scope or the app theme, so
 * each keeps the one mirrored token value (colors.live.text) and parses the title
 * itself. nowNextWidget.test.ts keeps the value in step with the token. The widget extension
 * does not bundle Clash Display (expo-widgets has no font option), so the set name
 * uses the bold system face until it does.
 */
type NowNextProps = {
  /** e.g. "Now: Artist" or "Next: Artist in 25m". */
  title: string;
  /** e.g. "Main Stage · until 9:45" or "in 25m". */
  subtitle: string;
  /** ISO target time rendered by SwiftUI as a native, live-updating timer. */
  endsAt?: string | null;
};

const NowNextActivity = (props: NowNextProps, _environment: LiveActivityEnvironment) => {
  'widget';

  // Widget-marked functions run in an isolated runtime and cannot reference
  // module-scope values. Keep the mirrored token (colors.live.text) inside the function.
  const live = '#39ff14';
  const timer = props.endsAt ? new Date(props.endsAt) : null;
  // Title is "Now: Name" or "Next: Name in 25m"; the native timer replaces the countdown text.
  const sep = props.title.indexOf(': ');
  const label = sep > 0 ? props.title.slice(0, sep) : '';
  const rest = sep > 0 ? props.title.slice(sep + 2) : props.title;
  const inAt = rest.lastIndexOf(' in ');
  const name = label === 'Next' && inAt > 0 ? rest.slice(0, inAt) : rest;
  const isNow = label === 'Now';
  const countdownLeads = label === 'Next' && timer !== null;
  const dim = [opacity(0.7)];
  const glyph = isNow ? 'circle.fill' : 'music.note';

  return {
    // Lock Screen / banner: one lead object, then a quiet detail line.
    banner: (
      <VStack modifiers={[padding({ all: 14 }), activityBackgroundTint('black'), preferredColorScheme('dark')]}>
        {isNow ? (
          <HStack>
            <Image systemName="circle.fill" color={live} />
            <Text modifiers={[font({ weight: 'bold', size: 12 }), foregroundStyle(live), padding({ leading: 6 })]}>
              NOW
            </Text>
            <Spacer />
          </HStack>
        ) : (
          <Text modifiers={[font({ weight: 'bold', size: 12 }), ...dim]}>{label ? label.toUpperCase() : 'FESTIE'}</Text>
        )}
        {countdownLeads && timer ? (
          <Text date={timer} dateStyle="timer" modifiers={[font({ weight: 'bold', size: 30 }), monospacedDigit()]} />
        ) : null}
        <Text modifiers={[font({ weight: 'bold', size: countdownLeads ? 16 : 22 }), lineLimit(2)]}>{name}</Text>
        <Text modifiers={[font({ size: 13 }), lineLimit(2), ...dim]}>{props.subtitle}</Text>
      </VStack>
    ),
    // Dynamic Island: compact, minimal, expanded.
    compactLeading: <Image systemName={glyph} color={isNow ? live : undefined} />,
    compactTrailing: timer ? (
      <Text date={timer} dateStyle="timer" modifiers={[font({ size: 12 }), monospacedDigit()]} />
    ) : (
      <Text modifiers={[font({ size: 12 })]}>Festie</Text>
    ),
    minimal: <Image systemName={glyph} color={isNow ? live : undefined} />,
    expandedLeading: <Image systemName={glyph} color={isNow ? live : undefined} modifiers={[padding({ all: 8 })]} />,
    expandedTrailing: (
      <VStack modifiers={[padding({ all: 8 })]}>
        {timer ? (
          <Text date={timer} dateStyle="timer" modifiers={[font({ weight: 'bold', size: 15 }), monospacedDigit()]} />
        ) : null}
        <Text modifiers={[font({ size: 12 }), lineLimit(2), ...dim]}>{props.subtitle}</Text>
      </VStack>
    ),
    expandedCenter: (
      <Text modifiers={[font({ weight: 'bold', size: 17 }), lineLimit(2), padding({ all: 8 })]}>{name}</Text>
    ),
  };
};

export const NowNextActivityFactory = createLiveActivity<NowNextProps>('NowNextLiveActivity', NowNextActivity);
export default NowNextActivityFactory;

// ---------------------------------------------------------------------------
// Home-screen widget layout (systemSmall + systemMedium).
//
// Uses the same NowNextProps shape as the Live Activity so a single
// updateSnapshot({ title, subtitle, endsAt }) call in useOngoingNotification
// keeps both surfaces in sync. This home-screen widget name matches app.json;
// the Live Activity uses its own runtime-only name above.
// ---------------------------------------------------------------------------

const NowNextWidget = (props: NowNextProps, env: WidgetEnvironment) => {
  'widget';

  const live = '#39ff14';
  const isSmall = env.widgetFamily === 'systemSmall';
  const timer = props.endsAt ? new Date(props.endsAt) : null;
  const sep = props.title.indexOf(': ');
  const label = sep > 0 ? props.title.slice(0, sep) : '';
  const rest = sep > 0 ? props.title.slice(sep + 2) : props.title;
  const inAt = rest.lastIndexOf(' in ');
  const name = label === 'Next' && inAt > 0 ? rest.slice(0, inAt) : rest;
  const isNow = label === 'Now';
  const countdownLeads = label === 'Next' && timer !== null;
  const dim = [opacity(0.7)];

  // Stage ground in both system schemes; one lead object, then the detail line.
  return (
    <VStack modifiers={[padding({ all: 14 }), containerBackground('black', 'widget'), preferredColorScheme('dark')]}>
      {isNow ? (
        <HStack>
          <Image systemName="circle.fill" color={live} />
          <Text modifiers={[font({ weight: 'bold', size: 12 }), foregroundStyle(live), padding({ leading: 6 })]}>
            NOW
          </Text>
          <Spacer />
        </HStack>
      ) : (
        <Text modifiers={[font({ weight: 'bold', size: 12 }), ...dim]}>{label ? label.toUpperCase() : 'FESTIE'}</Text>
      )}
      {countdownLeads && timer ? (
        <Text
          date={timer}
          dateStyle="timer"
          modifiers={[font({ weight: 'bold', size: isSmall ? 26 : 32 }), monospacedDigit()]}
        />
      ) : null}
      <Text modifiers={[font({ weight: 'bold', size: countdownLeads ? 15 : isSmall ? 18 : 22 }), lineLimit(2)]}>
        {name}
      </Text>
      <Text modifiers={[font({ size: isSmall ? 11 : 13 }), lineLimit(isSmall ? 2 : 3), ...dim]}>{props.subtitle}</Text>
    </VStack>
  );
};

export const NowNextWidgetInstance = createWidget<NowNextProps>('NowNextActivity', NowNextWidget);
