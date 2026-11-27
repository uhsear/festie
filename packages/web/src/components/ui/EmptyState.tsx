import React from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import { illustrationDataUri, illustrationSlot, type IllustrationName } from '@festie/shared/illustrations';
import { Heart, Inbox, Users, WifiOff, type LucideIcon } from 'lucide-react';
import { colors, colorsDaylight } from '@festie/shared/tokens';
import Button from './Button';
import GhostRow from './GhostRow';
import type { GhostRowKind } from '@festie/shared/constants/ghostRows';
import { cn } from '../../lib/utils';

// Shown at 48px instead of the illustration when the viewport is short (theme.css).
const FALLBACK_ICON: Record<IllustrationName, LucideIcon> = {
  noPicks: Heart,
  noCrew: Users,
  emptyList: Inbox,
  offline: WifiOff,
};

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  illustration?: IllustrationName;
  /** A product-derived ghost row drawn instead of the illustration. */
  ghostRow?: GhostRowKind;
  secondaryCta?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
  /** Heading level of the title. Defaults to 2; a page with no other content passes 1. */
  headingLevel?: 1 | 2 | 3;
}

export default function EmptyState({
  icon,
  title,
  description,
  cta,
  illustration,
  ghostRow,
  secondaryCta,
  className,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  // Read the ink from the tokens, not the DOM: data-theme is applied in a later effect.
  const theme = useUIStore((s) => s.theme);
  const ink = (theme === 'daylight' ? colorsDaylight : colors).text.secondary;
  return (
    <div
      className={cn(
        // R21: Container with flex centering.
        // Vertical padding scales with viewport so the empty state stays
        // proportionate in tight panels (crew/picks) and roomy on desktop.
        // className can still override (e.g. festival-mode's compact slot).
        'empty-state flex flex-col items-center justify-center gap-4 py-4 sm:py-6 px-6 text-center min-h-[200px]',
        className,
      )}
    >
      <div className="flex flex-col items-center gap-4 w-full">
        {ghostRow ? (
          <GhostRow kind={ghostRow} />
        ) : illustration ? (
          <>
            <img
              alt=""
              aria-hidden="true"
              src={illustrationDataUri(illustration, ink)}
              style={{ width: illustrationSlot.width, height: illustrationSlot.height }}
              className="empty-state-illustration object-contain"
            />
            <div className="empty-state-fallback-icon justify-center" aria-hidden="true">
              <div className="text-text-secondary [&_svg]:w-12 [&_svg]:h-12">
                {icon ?? React.createElement(FALLBACK_ICON[illustration])}
              </div>
            </div>
          </>
        ) : (
          icon && (
            <div className="flex justify-center">
              <div className="text-text-secondary [&_svg]:w-12 [&_svg]:h-12">{icon}</div>
            </div>
          )
        )}

        <Heading className="type-title font-semibold text-text-primary text-balance">{title}</Heading>

        {description && (
          <p className="text-sm text-text-secondary max-w-[280px] text-pretty">{description}</p>
        )}

        {(cta || secondaryCta) && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {cta && (
              <Button variant="primary" size="md" onClick={cta.onClick}>
                {cta.label}
              </Button>
            )}
            {secondaryCta && (
              <Button
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
