/** Shown above cached crew data when a background refetch fails. */
export default function StaleNote({ show, onRetry }: { show: boolean; onRetry: () => void }) {
  if (!show) return null;
  return (
    <p role="status" className="text-xs text-text-muted">
      Couldn't refresh. Showing saved data.{' '}
      <button type="button" className="underline" onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}
