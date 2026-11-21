import { Pressable, Text, type StyleProp, type TextStyle } from 'react-native';
// Subpath imports keep the shared barrels out of this leaf, the same as the web twin.
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';
import { artistNameSegments, artistTargetFromName } from '@festie/shared/utils/artistSheet';
import type { ArtistSheetTarget } from '@festie/shared/utils/artistSheet';
import type { FestivalSet } from '@festie/shared/types';
import { MAX_FONT_SCALE } from '../hooks/useTokens';

// Text lines run 16 to 28 px tall, so 12 px above and below brings a single line to the 44 px touch target.
const HIT_SLOP = { top: 12, bottom: 12, left: 4, right: 4 };

interface NameProps {
  name?: string;
  target?: ArtistSheetTarget;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  maxFontSizeMultiplier?: number;
  children?: string;
}

/** One artist name as its own button. It opens the shared artist sheet and is a sibling of any row button, never inside one. */
export function ArtistNameButton({ name, target, textStyle, numberOfLines, maxFontSizeMultiplier = MAX_FONT_SCALE, children }: NameProps) {
  const open = useArtistSheetStore((s) => s.open);
  const resolved = target ?? artistTargetFromName(name ?? '');
  return (
    <Pressable
      onPress={() => open(resolved)}
      hitSlop={HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={`Open ${resolved.title}`}
      style={{ alignSelf: 'flex-start', flexShrink: 1, maxWidth: '100%' }}
    >
      <Text style={textStyle} numberOfLines={numberOfLines} maxFontSizeMultiplier={maxFontSizeMultiplier}>
        {children ?? resolved.title}
      </Text>
    </Pressable>
  );
}

/** An artist name inside a Text line, for a B2B set where each artist opens its own sheet. */
export function ArtistNameInline({ target, name, children }: { target?: ArtistSheetTarget; name?: string; children: string }) {
  const open = useArtistSheetStore((s) => s.open);
  const resolved = target ?? artistTargetFromName(name ?? children);
  return (
    <Text onPress={() => open(resolved)} accessibilityRole="button" accessibilityLabel={`Open ${resolved.title}`} suppressHighlighting>
      {children}
    </Text>
  );
}

/** A set's name as pressable runs for use inside a Text line, each artist of a B2B set on its own. */
export function ArtistNameRuns({ set, separator }: { set: FestivalSet; separator?: string }) {
  const sep = separator || 'b2b';
  return (
    <>
      {artistNameSegments(set, separator).map((seg, i) => (
        <Text key={`${seg.label}-${i}`}>
          {i > 0 ? ` ${sep} ` : ''}
          <ArtistNameInline target={seg.target}>{seg.label}</ArtistNameInline>
        </Text>
      ))}
    </>
  );
}

/**
 * A set's artist name. One name is a single button; a B2B set whose shown name is just its artists joined
 * is one Text line with each artist pressable on its own.
 */
export default function ArtistName({
  set,
  separator,
  textStyle,
  numberOfLines,
  maxFontSizeMultiplier = MAX_FONT_SCALE,
}: {
  set: FestivalSet;
  separator?: string;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  maxFontSizeMultiplier?: number;
}) {
  const segments = artistNameSegments(set, separator);
  const only = segments.length === 1 ? segments[0] : undefined;
  if (only) {
    return (
      <ArtistNameButton
        target={only.target}
        textStyle={textStyle}
        numberOfLines={numberOfLines}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
      >
        {only.label}
      </ArtistNameButton>
    );
  }
  return (
    <Text style={textStyle} numberOfLines={numberOfLines} maxFontSizeMultiplier={maxFontSizeMultiplier}>
      <ArtistNameRuns set={set} separator={separator} />
    </Text>
  );
}
