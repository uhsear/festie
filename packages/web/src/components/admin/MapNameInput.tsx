import { useState } from 'react';

/** Name field with a local draft; commits on blur or Enter so each keystroke does not rewrite the map config. */
export default function MapNameInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      type="text"
      aria-label={`Name of ${label}`}
      placeholder="Unnamed"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className="flex-1 min-w-0 px-2 py-1 rounded-md bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
    />
  );
}
