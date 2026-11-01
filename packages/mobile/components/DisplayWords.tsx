import { Fragment } from 'react';
import { Platform, Text } from 'react-native';
import { wordSpacing } from '@festie/shared/tokens';

/**
 * Renders display text with the word gap the brand spec asks for. Use only
 * inside a parent <Text>. On iOS the visible string is unchanged. On Android
 * each inter-word space becomes U+2005 (0.25em, close to the brand gap) because
 * positive letter-spacing under-measures there, so Maestro text matchers on
 * multi-word display text need a regex on Android.
 */
export default function DisplayWords({ text, fontSize }: { text: string; fontSize?: number }) {
  // RN Text has no wordSpacing; Clash Display's 0.14em space runs words together.
  if (Platform.OS === 'android') return <>{text.replace(/ /g, ' ')}</>;
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
