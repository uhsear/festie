import { FESTIE_MARK_PIN_PATH, FESTIE_MARK_TENT_PATH } from '@festie/shared/brand';
import { colors } from '@festie/shared/tokens';

/**
 * The full Festie mark, drawn inline so the poster capture needs no image fetch. The viewBox frames the
 * art at the same 64.6% of the box that the mobile poster's splash-icon.png uses.
 */
export default function PosterMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="64 60 384 384" aria-hidden="true">
      <path fill={colors.accent.coral} d={FESTIE_MARK_TENT_PATH} />
      <path fill={colors.accent.aqua} fillRule="evenodd" d={FESTIE_MARK_PIN_PATH} />
    </svg>
  );
}
