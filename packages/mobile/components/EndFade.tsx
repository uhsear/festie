import { useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTokens } from '../hooks/useTokens';

/**
 * Scroll-hint state for a horizontal ScrollView: `more` is true while content
 * lies past the right edge. Spread `scrollProps` onto the ScrollView and render
 * <EndFade visible={more} /> inside a relative wrapper around it.
 */
export function useScrollMore() {
  const m = useRef({ view: 0, content: 0, x: 0 });
  const [more, setMore] = useState(false);
  const update = (patch: Partial<typeof m.current>) => {
    Object.assign(m.current, patch);
    const { view, content, x } = m.current;
    setMore(view > 0 && content - view - x > 1);
  };
  const scrollProps = {
    onLayout: (e: LayoutChangeEvent) => update({ view: e.nativeEvent.layout.width }),
    onContentSizeChange: (w: number) => update({ content: w }),
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => update({ x: e.nativeEvent.contentOffset.x }),
    scrollEventThrottle: 32,
  };
  return { more, scrollProps };
}

/** Right-edge fade into the screen background: tells the user the row scrolls instead of clipping hard. */
export default function EndFade({ visible, bottom = 0 }: { visible: boolean; bottom?: number }) {
  const t = useTokens();
  if (!visible) return null;
  return (
    <View pointerEvents="none" style={[styles.fade, { width: t.spacing[8], bottom }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="endFade" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={t.colors.bg.primary} stopOpacity={0} />
            <Stop offset="1" stopColor={t.colors.bg.primary} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#endFade)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fade: { position: 'absolute', top: 0, right: 0 },
});
