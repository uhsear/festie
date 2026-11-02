import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { POSTER } from '@festie/shared/tokens';

const PIECES = 24;
const PALETTE = [POSTER.colors.accent, POSTER.colors.text, POSTER.colors.secondary];

/** One-shot confetti burst. Renders nothing under reduced motion. Not part of the captured poster. */
export default function ConfettiBurst() {
  const reduceMotion = useReducedMotion();
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        const angle = (i / PIECES) * Math.PI * 2;
        const dist = 90 + (i % 5) * 28;
        return {
          x: Math.cos(angle) * dist,
          y: Math.sin(angle) * dist - 40,
          rotate: (i * 47) % 360,
          color: PALETTE[i % PALETTE.length],
        };
      }),
    [],
  );
  if (reduceMotion) return null;
  return (
    <div aria-hidden="true" data-testid="confetti" className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute left-1/2 top-1/3 block h-2 w-2"
          style={{ backgroundColor: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y + 120, opacity: 0, rotate: p.rotate }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
