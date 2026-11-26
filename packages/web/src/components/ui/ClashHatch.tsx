import React from 'react';
import { cn } from '../../lib/utils';

interface ClashHatchProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * The one clash shape: a diagonal-striped bar in the clash colour (2 px stripe, 3 px clear). Callers size and
 * place it; pair it with the minutes numeral. Decorative, so the clash text carries the meaning.
 */
export default function ClashHatch({ className, style }: ClashHatchProps) {
  return (
    <span
      data-clash-hatch
      className={cn(
        'inline-block shrink-0 pointer-events-none [background:repeating-linear-gradient(135deg,var(--color-clash)_0_2px,transparent_2px_5px)]',
        className,
      )}
      style={style}
      aria-hidden="true"
    />
  );
}
