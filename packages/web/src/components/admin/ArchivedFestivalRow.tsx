import type { ArchivedFestival } from '@festie/shared/services/festivalAdmin';
import { timeAgo } from '@festie/shared/utils';
import { rowButton } from './adminFestivalStyles';

interface ArchivedFestivalRowProps {
  item: ArchivedFestival;
  onRestore: () => void;
}

export default function ArchivedFestivalRow({ item, onRestore }: ArchivedFestivalRowProps) {
  return (
  <div
      className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 flex items-center justify-between"
  >
    <div className="flex-1">
      <h2 className="text-base font-semibold text-text-primary">{item.name}</h2>
      <p className="text-sm text-text-muted">
        {item.location} · Deleted {timeAgo(Date.parse(item.deletedAt))}
      </p>
    </div>
    <button onClick={() => onRestore()} aria-label={`Restore ${item.name}`} className={rowButton}>
      Restore
    </button>
  </div>
  );
}
