import React from 'react';
import { POLL_END_CHOICES, type PollEndChoice } from '@festie/shared';

interface PollEndPickerProps {
  labelId: string;
  value: PollEndChoice;
  onChange: (choice: PollEndChoice) => void;
  choices?: readonly { id: PollEndChoice; label: string }[];
}

export default function PollEndPicker({ labelId, value, onChange, choices = POLL_END_CHOICES }: PollEndPickerProps) {
  return (
    <div>
      <span id={labelId} className="block text-sm font-medium text-text-primary mb-2">
        Ends
      </span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={labelId}>
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value === c.id}
            onClick={() => onChange(c.id)}
            className={`min-h-11 px-3 rounded-full border text-sm ${
              value === c.id ? 'border-accent-aqua text-accent-aqua' : 'border-glass-border text-text-secondary'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
