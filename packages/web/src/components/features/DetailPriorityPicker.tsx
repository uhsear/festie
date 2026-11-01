import type { LucideIcon } from 'lucide-react';
import { X, Clock } from 'lucide-react';
import { usePickSync } from '@festie/shared/hooks';
import { Priority } from '@festie/shared/types';
import { PRIORITY_SYMBOLS } from '@festie/shared/constants';
import { cn } from '../../lib/utils';
import { priorityLucide } from '../ui/PriorityIcon';

interface Props {
  setId: string;
  myPick: Priority | null;
  priorityBusy: Priority | null | 'clear';
  onPriorityClick: (priority: Priority | null) => Promise<void>;
}

// Icons and labels come from the shared PRIORITY_SYMBOLS set, so the same
// concept renders identically across cards, grid, picks and this panel.
// `X` is the Clear affordance.
const priorityOptions: Array<{ value: Priority | null; Icon: LucideIcon; label: string }> = [
  { value: 'must', Icon: priorityLucide('must'), label: PRIORITY_SYMBOLS.must.label },
  { value: 'want-to-see', Icon: priorityLucide('want-to-see'), label: PRIORITY_SYMBOLS['want-to-see'].label },
  { value: 'maybe', Icon: priorityLucide('maybe'), label: PRIORITY_SYMBOLS.maybe.label },
  { value: null, Icon: X, label: 'Clear' },
];

// Selected fill mirrors SetCard's active priority buttons (solid fill + glow,
// not a border/tint) so the same concept reads identically in both places.
const activeStyles: Record<Priority, string> = {
  must: 'border-priority-must bg-accent-coral-strong text-text-on-accent shadow-[var(--shadow-glow-coral),0_0_0_1px_var(--color-coral-a3)]',
  'want-to-see':
    'border-priority-want bg-priority-want text-[var(--text-on-light-accent)] shadow-[var(--shadow-glow-aqua),0_0_0_1px_var(--color-aqua-a3)]',
  maybe:
    'border-priority-maybe bg-priority-maybe text-[var(--text-on-light-accent)] shadow-[var(--shadow-glow-amber),0_0_0_1px_var(--color-amber-a3)]',
};

const baseButtonClass =
  'flex-1 py-3 min-h-[44px] rounded-DEFAULT text-center bg-bg-card border-2 border-border cursor-pointer transition-[background-color,border-color,transform,box-shadow,color] duration-200 ease-[var(--ease-standard)] text-text-primary touch-manipulation appearance-none overflow-hidden hover:border-text-muted hover:bg-bg-card-hover active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-accent-aqua focus-visible:outline-offset-2';

export default function DetailPriorityPicker({ setId, myPick, priorityBusy, onPriorityClick }: Props) {
  const { sync, retry } = usePickSync(setId);
  const pending = sync?.state === 'saving' || sync?.state === 'queued';
  const pendingSuffix = sync?.state === 'queued' ? ' (saved on this device, will sync)' : ' (saving)';
  return (
    <div className="mb-6">
    <div className="flex gap-4">
      {priorityOptions.map(({ value: p, Icon, label }) => {
        const active = p !== null && myPick === p;
        const key: Priority | 'clear' = p ?? 'clear';
        const isThisBusy = priorityBusy === key;
        const anyBusy = priorityBusy !== null;
        return (
          <button
            key={label}
            className={cn(baseButtonClass, active && p !== null && activeStyles[p])}
            type="button"
            aria-pressed={p === null ? undefined : active ? 'true' : 'false'}
            aria-label={label + (active && pending ? pendingSuffix : '')}
            aria-busy={isThisBusy ? 'true' : 'false'}
            disabled={anyBusy || (p === null && !myPick)}
            onClick={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (priorityBusy !== null) return;
              await onPriorityClick(p);
            }}
          >
            {/* Fill the glyph when active (Clear's X stays an outline — it has no
                meaningful fill area). Mirrors SetCard's fill-on-active treatment. */}
            <Icon
              className="w-5 h-5 mx-auto"
              fill={active ? 'currentColor' : 'none'}
              aria-hidden="true"
            />
            <div className="text-[length:var(--font-size-12)] font-bold mt-1 uppercase tracking-[0.5px]">{label}</div>
            {active && pending && <Clock className="w-3 h-3 mx-auto mt-1" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
    {sync?.state === 'failed' && (
      <div role="status" className="mt-2 text-xs text-accent-amber">
        Pick not saved.{' '}
        <button
          type="button"
          className="min-h-[44px] px-2 underline cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua"
          onClick={() => void retry()}
        >
          Retry
        </button>
      </div>
    )}
    </div>
  );
}
