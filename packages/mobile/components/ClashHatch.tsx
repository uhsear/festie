import { useId } from 'react';
import type { ViewStyle } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import type { ClashSegment } from '@festie/shared/utils';

interface ClashHatchProps {
  segments: ClashSegment[];
  height: number;
  color: string;
  width?: number;
}

/** One hatched bar. Stripes: 2 px colour, 3 px clear. The one clash shape on every surface. */
function HatchBar({ width, height, color, style }: { width: number; height: number; color: string; style?: ViewStyle }) {
  const id = `clash-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={width} height={height} pointerEvents="none" accessible={false} style={style}>
      <Defs>
        <Pattern id={id} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
          <Rect width={2} height={5} fill={color} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** Hatched bar down a block's left edge over each overlapping part. */
export default function ClashHatch({ segments, height, color, width = 6 }: ClashHatchProps) {
  return (
    <>
      {segments.map((seg) => (
        <HatchBar
          key={`${seg.from}-${seg.to}`}
          width={width}
          height={(seg.to - seg.from) * height}
          color={color}
          style={{ position: 'absolute', left: 0, top: seg.from * height }}
        />
      ))}
    </>
  );
}

/** The same hatch as an inline swatch, for chips and headings that name a clash. */
export function ClashSwatch({ color, height = 14, width = 6 }: { color: string; height?: number; width?: number }) {
  return <HatchBar width={width} height={height} color={color} />;
}
