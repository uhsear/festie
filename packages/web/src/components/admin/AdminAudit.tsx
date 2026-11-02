import React, { useEffect, useState } from 'react';
import { fetchAuditPage, type AuditEntry } from '@festie/shared/services/admin';
import { AUDIT_ACTION_FILTERS, timeAgoFromIso } from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import { SearchX } from 'lucide-react';

const PAGE_SIZE = 50;

type Scope = 'admin' | 'user';

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'admin', label: 'Admin actions' },
  { value: 'user', label: 'User activity' },
];

/**
 * Audit log viewer with filtering and pagination
 */
export default function AdminAudit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [scope, setScope] = useState<Scope>('admin');
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  // Stack of previous cursors for back-navigation; null = first page
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([]);
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { toastError } = useToast();

  useEffect(() => {
    loadAudit();
  }, [currentCursor, scope, actionFilter, userFilter, dateFrom, dateTo]); // eslint-disable-line react-hooks/exhaustive-deps -- loadAudit reads filter state directly

  const loadAudit = async () => {
    try {
      setLoading(true);
      const page = await fetchAuditPage({
        limit: PAGE_SIZE,
        scope,
        cursor: currentCursor,
        action: actionFilter,
        actor: userFilter,
        from: dateFrom,
        to: dateTo,
      });
      setEntries(page.entries);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch (err: unknown) {
      toastError(err, "Couldn't load the audit log. Try again.");
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  };

  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack((prev) => [...prev, currentCursor]);
    setCurrentCursor(nextCursor);
  };

  const goPrev = () => {
    if (cursorStack.length === 0) return;
    const prev = [...cursorStack];
    const lastCursor = prev.pop()!;
    setCursorStack(prev);
    setCurrentCursor(lastCursor);
  };

  const resetPagination = () => {
    setCursorStack([]);
    setCurrentCursor(null);
  };

  const hasFilters = Boolean(actionFilter || userFilter || dateFrom || dateTo);
  const from = cursorStack.length * PAGE_SIZE + 1;
  const to = cursorStack.length * PAGE_SIZE + entries.length;

  // Only show the full-page spinner on first load. Subsequent filter/page
  // changes keep the table visible and dim it via aria-busy so the view
  // doesn't flash to "Loading..." every keystroke.
  if (loading && !hasLoadedOnce) {
    return <div className="text-center py-12 text-text-muted">Loading audit log…</div>;
  }

  return (
    <div className="space-y-6" aria-busy={loading}>
      <div role="group" aria-label="Audit log scope" className="inline-flex rounded-lg border border-glass-border overflow-hidden">
        {SCOPE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={scope === option.value}
            onClick={() => {
              setScope(option.value);
              resetPagination();
            }}
            className={`px-4 py-2 min-h-11 text-sm font-medium transition-colors ${
              scope === option.value
                ? 'bg-accent-aqua/20 text-accent-aqua'
                : 'bg-bg-card text-text-muted hover:bg-bg-card/80'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
        <h2 className="type-label text-text-primary mb-3">Filters</h2>
        <div role="group" aria-label="Filter by action type" className="flex flex-wrap gap-2 mb-3">
          {AUDIT_ACTION_FILTERS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              aria-pressed={actionFilter === chip.prefix}
              onClick={() => {
                setActionFilter(chip.prefix);
                resetPagination();
              }}
              className={`px-4 py-2 min-h-11 rounded-full text-sm font-medium transition-colors ${
                actionFilter === chip.prefix
                  ? 'bg-accent-aqua/20 text-accent-aqua'
                  : 'bg-bg-primary text-text-muted hover:bg-bg-card/80'
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <input
            type="text"
            placeholder="Username…"
            aria-label="Filter by username"
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              resetPagination();
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="date"
            aria-label="Filter: date from"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              resetPagination();
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
          <input
            type="date"
            aria-label="Filter: date to"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              resetPagination();
            }}
            className="px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          />
        </div>
      </div>

      {/* Entries */}
      {entries.length === 0 ? (
        <EmptyState
          icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
          title={scope === 'admin' && !hasFilters ? 'No admin actions yet' : 'No audit entries found'}
          description={
            scope === 'admin' && !hasFilters
              ? 'Role changes, deletes and imports appear here.'
              : 'Try adjusting your filters or date range.'
          }
        />
      ) : (
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
          <div className="divide-y divide-glass-border">
            {entries.map((entry) => (
              <div
                key={entry.id}
                role="button"
                tabIndex={0}
                aria-expanded={expandedId === entry.id}
                className="px-6 py-4 hover:bg-bg-primary/20 transition-colors cursor-pointer"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setExpandedId(expandedId === entry.id ? null : entry.id);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="font-medium text-text-primary">
                      {entry.friendlyAction}
                      {entry.status !== 'success' && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral text-xs">
                          Failed
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {[entry.actorUsername || 'system', entry.targetLabel, timeAgoFromIso(entry.createdAt)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="text-xl text-text-muted ml-4">{expandedId === entry.id ? '−' : '+'}</div>
                </div>

                {expandedId === entry.id && entry.details && (
                  <div className="mt-4 pt-4 border-t border-glass-border">
                    <pre className="bg-bg-primary/30 p-3 rounded-lg text-xs text-text-secondary overflow-x-auto">
                      {JSON.stringify(entry.details, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pagination */}
      {entries.length > 0 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={goPrev}
            disabled={cursorStack.length === 0}
            className="px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-muted text-sm">Page {cursorStack.length + 1}</span>
          <button
            onClick={goNext}
            disabled={!nextCursor}
            className="px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Next
          </button>
        </div>
      )}
      {entries.length > 0 && (
        <p className="text-center text-xs text-text-muted">
          Showing {from}–{to} of {total}
        </p>
      )}
    </div>
  );
}
