import type { ReactNode } from 'react';
import { useUIStore } from '@festie/shared/stores/uiStore';
import Button from '../ui/Button';

interface ErrorStateProps {
  heading: string;
  description: ReactNode;
  /** The one recovery action. */
  action: { label: string; onClick: () => void };
  /** Heading level; the full-page boundary passes 1. */
  headingLevel?: 1 | 2;
  'aria-label'?: string;
}

/**
 * The one error layout shared by every boundary: the Festie mark, a heading, one sentence and one
 * button. Boundaries differ only in the copy and the action they pass in.
 */
export default function ErrorState({ heading, description, action, headingLevel = 2, 'aria-label': ariaLabel }: ErrorStateProps) {
  const theme = useUIStore((s) => s.theme);
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className="flex flex-col items-center justify-center h-full text-center gap-3 p-12"
      role="alert"
      aria-label={ariaLabel}
    >
      <img src={theme === 'daylight' ? '/favicon-daylight.svg' : '/favicon.svg'} width={48} height={48} alt="" />
      <Heading className="m-0 type-title font-semibold text-text-primary">{heading}</Heading>
      <p className="m-0 text-sm text-text-secondary max-w-[400px]">{description}</p>
      <Button variant="primary" size="md" type="button" onClick={action.onClick} className="mt-2">
        {action.label}
      </Button>
    </div>
  );
}
