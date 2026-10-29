import { Fragment } from 'react';
import { Platform, Text } from 'react-native';
import { wordSpacing } from '@festie/shared/tokens';

/**
 * Renders display text with the word gap the brand spec asks for. Use only
 * inside a parent <Text>. The visible string is unchanged, so Maestro text
 * matchers and VoiceOver are unaffected.
 */
export default function DisplayWords({ text, fontSize }: { text: string; fontSize?: number }) {
  // RN Text has no wordSpacing; Clash Display's 0.14em space runs words together. iOS only: positive tracking has under-measured on Android.
  if (Platform.OS !== 'ios' || !fontSize) return <>{text}</>;
  return (
    <>
      {text.split(' ').map((word, i) => (
        <Fragment key={i}>
          {i > 0 ? <Text style={{ letterSpacing: wordSpacing.display * fontSize }}>{' '}</Text> : null}
          {word}
        </Fragment>
      ))}
    </>
  );
}
