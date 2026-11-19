import { cn } from '../../lib/utils';

export type OpenView = 'edit' | 'map' | 'import';

const SUB_TABS: ReadonlyArray<{ view: OpenView; label: string }> = [
  { view: 'edit', label: 'Details' },
  { view: 'map', label: 'Map' },
  { view: 'import', label: 'Import lineup' },
];

interface AdminFestivalSubTabsProps {
  current: OpenView;
  onSelect: (view: OpenView) => void;
}

export default function AdminFestivalSubTabs({ current, onSelect }: AdminFestivalSubTabsProps) {
  return (
  <div className="flex gap-2 overflow-x-auto border-b border-glass-border">
    {SUB_TABS.map(({ view: v, label }) => (
      <button
        key={v}
        type="button"
        aria-current={current === v ? 'page' : undefined}
        onClick={() => current !== v && onSelect(v)}
        className={cn(
          'px-4 py-2 min-h-11 whitespace-nowrap font-medium text-sm transition-colors border-b-2',
          current === v
            ? 'border-accent-aqua text-text-primary'
            : 'border-transparent text-text-secondary hover:text-text-primary',
        )}
      >
        {label}
      </button>
    ))}
  </div>
  );
}
