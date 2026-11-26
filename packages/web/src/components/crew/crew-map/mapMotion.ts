import { durationSpatial } from '@festie/shared/tokens';

/** Camera move length in ms: none under reduced motion, else the slow spatial token. */
export function cameraDuration(): number {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  return reduce ? 0 : durationSpatial.slow;
}

/** Next CSS rotation that reaches `target` by the shortest turn, so 359 to 1 degrees turns 2, not 358. */
export function unwrapAngle(prev: number, target: number): number {
  return prev + ((((target - prev + 180) % 360) + 360) % 360) - 180;
}
