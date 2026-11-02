import { cn } from '../../lib/utils';

interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

export default function Switch({
  checked,
  onChange,
  label,
  labelledBy,
  describedBy,
  disabled,
  'data-testid': testId,
}: SwitchProps) {
  return (
    <span className="inline-flex items-center justify-center min-h-11 min-w-11 shrink-0">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-11 h-6 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua disabled:opacity-60',
          checked ? 'bg-accent-aqua' : 'bg-control-track-off',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </span>
  );
}
