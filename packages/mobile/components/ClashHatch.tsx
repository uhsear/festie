import { useId } from 'react';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';
import type { ClashSegment } from '@festie/shared/utils';

interface ClashHatchProps {
  segments: ClashSegment[];
  height: number;
  color: string;
  width?: number;
}

/** Hatched bar down a block's left edge over each overlapping part. Stripes: 2 px colour, 3 px clear. */
export default function ClashHatch({ segments, height, color, width = 6 }: ClashHatchProps) {
  const id = `clash-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <>
      {segments.map((seg) => (
        <Svg
          key={`${seg.from}-${seg.to}`}
          width={width}
          height={(seg.to - seg.from) * height}
          pointerEvents="none"
          accessible={false}
          style={{ position: 'absolute', left: 0, top: seg.from * height }}
        >
          <Defs>
            <Pattern id={id} patternUnits="userSpaceOnUse" width={5} height={5} patternTransform="rotate(45)">
              <Rect width={2} height={5} fill={color} />
            </Pattern>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      ))}
    </>
  );
}
