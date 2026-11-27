import type { ReactNode } from 'react';
import type { Crew } from '@festie/shared/types';

interface CrewHeaderProps {
  crew: Crew;
  /** The crew switcher. It is the visible title, so the crew name and festival print once. */
  selector: ReactNode;
  /** Owner actions that sit beside the title (rename). */
  action?: ReactNode;
}

export default function CrewHeader({ crew, selector, action }: CrewHeaderProps) {
  return (
    <header className="flex items-center gap-2 min-w-0">
      {/* The switcher below is the visible title; this keeps the page outline and screen readers on the crew name. */}
      <h1 className="sr-only">{crew.name}</h1>
      <div className="flex-1 min-w-0">{selector}</div>
      {action}
    </header>
  );
}
