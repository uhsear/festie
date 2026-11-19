import { useRef, type ReactNode } from 'react';
import { useRovingTabs } from '@/hooks/useRovingTabs';
import { cn } from '@/lib/utils';

interface SegmentedTablistProps<T extends string> {
  label: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  panelId: string;
  /** Soft aqua tint (default) or a solid aqua fill for the selected tab. */
  tone?: 'soft' | 'solid';
  /** Container layout and surface classes. */
  className?: string;
  /** Per-tab layout classes. */
  tabClassName?: string;
}

const ACTIVE = {
  soft: 'bg-accent-aqua/15 text-accent-aqua',
  solid: 'bg-accent-aqua text-bg-primary',
} as const;

export default function SegmentedTablist<T extends string>({
  label,
  options,
  value,
  onChange,
  panelId,
  tone = 'soft',
  className,
  tabClassName,
}: SegmentedTablistProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  useRovingTabs(ref);
  return (
    <div ref={ref} role="tablist" aria-label={label} className={cn('p-1 border border-border', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          aria-controls={panelId}
          onClick={() => onChange(o.value)}
          className={cn(
            'min-h-11 text-xs font-medium',
            tabClassName,
            value === o.value ? ACTIVE[tone] : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
