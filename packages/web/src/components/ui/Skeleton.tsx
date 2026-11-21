import { createContext, useContext, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

// Inside a SkeletonGroup the group is the one live region; its Skeletons are decoration.
const InSkeletonGroup = createContext(false);

/**
 * One "Loading" status for a set of Skeletons, so a screen reader announces a load once
 * instead of once per placeholder. Pass the layout classes the placeholders' wrapper needs.
 */
export function SkeletonGroup({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className={className}>
      <InSkeletonGroup.Provider value={true}>{children}</InSkeletonGroup.Provider>
    </div>
  );
}

interface SkeletonProps {
  variant?: 'text' | 'circle' | 'card' | 'header';
  className?: string;
}

export default function Skeleton({
  variant = 'text',
  className,
}: SkeletonProps) {
  const grouped = useContext(InSkeletonGroup);
  const variantStyles = {
    text: 'h-4 w-full rounded',
    circle: 'w-10 h-10 rounded-full',
    card: 'h-32 w-full rounded-lg',
    header: 'h-8 w-1/3 rounded mb-4',
  };

  return (
    <div
      className={cn(
        'skeleton-shimmer',
        variantStyles[variant],
        className
      )}
      {...(grouped
        ? { 'aria-hidden': true }
        : {
            // role=status is the ARIA loading-indicator role: it supports an accessible
            // name, so aria-label is valid here (a bare <div> prohibits it → axe
            // `aria-prohibited-attr`). Keeps aria-busy + the "Loading" name intact.
            role: 'status',
            'aria-busy': true,
            'aria-label': 'Loading',
          })}
    />
  );
}
