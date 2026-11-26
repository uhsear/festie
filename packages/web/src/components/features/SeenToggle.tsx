import { cn } from '../../lib/utils';

const segmentClass =
  'min-h-11 px-4 text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-aqua';
const onClass = 'bg-accent-aqua text-[var(--text-on-light-accent)]';
const offClass = 'text-text-secondary';

interface Props {
  /** The artist, when the page shows many rows, so each button names its row. Omit on a one-set screen. */
  name?: string;
  /** true is Saw it, false is Missed it, null is neither. */
  value: boolean | null;
  onChange: (next: boolean) => void;
}

/** A two-state segmented control for "Saw it" and "Missed it". Pressing the active segment calls onChange again, so the caller decides whether that clears. */
export default function SeenToggle({ name, value, onChange }: Props) {
  return (
    <div role="group" aria-label={name ?? 'Did you see it?'} className="inline-flex overflow-hidden rounded-full border border-border">
      <button
        type="button"
        aria-label={name ? `Saw it, ${name}` : undefined}
        aria-pressed={value === true}
        onClick={() => onChange(true)}
        className={cn(segmentClass, value === true ? onClass : offClass)}
      >
        Saw it
      </button>
      <button
        type="button"
        aria-label={name ? `Missed it, ${name}` : undefined}
        aria-pressed={value === false}
        onClick={() => onChange(false)}
        className={cn(segmentClass, 'border-l border-border', value === false ? onClass : offClass)}
      >
        Missed it
      </button>
    </div>
  );
}
