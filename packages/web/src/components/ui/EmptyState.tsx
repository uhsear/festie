import React from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { illustrationDataUri, type IllustrationName } from '@festie/shared/illustrations';
import { colors, colorsDaylight } from '@festie/shared/tokens';
import Button from './Button';
import { cn } from '../../lib/utils';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  illustration?: IllustrationName;
  secondaryCta?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  cta,
  illustration,
  secondaryCta,
  className,
}: EmptyStateProps) {
  // Read the ink from the tokens, not the DOM: data-theme is applied in a later effect.
  const theme = useUIStore((s) => s.theme);
  const ink = (theme === 'daylight' ? colorsDaylight : colors).text.secondary;
  return (
    <div
      className={cn(
        // R21: Container with dot-grid background and flex centering.
        // Vertical padding scales with viewport so the empty state stays
        // proportionate in tight panels (crew/picks) and roomy on desktop.
        // className can still override (e.g. festival-mode's compact slot).
        'empty-state flex flex-col items-center justify-center gap-4 py-4 sm:py-6 px-6 text-center min-h-[200px]',
        className,
      )}
    >
      <div className="empty-state-content flex flex-col items-center gap-4 w-full">
        {illustration ? (
          <img
            alt=""
            aria-hidden="true"
            src={illustrationDataUri(illustration, ink)}
            className="w-40 h-28"
          />
        ) : (
          icon && (
            <div className="empty-state-icon flex justify-center">
              <div className="text-text-secondary [&_svg]:w-12 [&_svg]:h-12">{icon}</div>
            </div>
          )
        )}

        <h3 className="empty-state-title type-title font-semibold text-text-primary">{title}</h3>

        {description && (
          <p className="empty-state-description text-sm text-text-secondary max-w-[280px]">{description}</p>
        )}

        {(cta || secondaryCta) && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {cta && (
              <Button className="empty-state-cta" variant="primary" size="md" onClick={cta.onClick}>
                {cta.label}
              </Button>
            )}
            {secondaryCta && (
              <Button
                className="empty-state-secondary-cta"
                variant="secondary"
                size="md"
                onClick={secondaryCta.onClick}
              >
                {secondaryCta.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
