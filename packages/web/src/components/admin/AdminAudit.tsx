import React, { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { exportAuditCsv, fetchAuditPage } from '@festie/shared/services/admin';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  AUDIT_ACTION_FILTERS,
  auditActionLabel,
  describeAuditChanges,
  parseAuditQuery,
  removeAuditQueryToken,
  setAuditQueryAction,
  timeAgoFromIso,
  type AuditQueryFilters,
} from '@festie/shared/utils';
import { useToast } from '../../lib/toastContext';
import EmptyState from '../ui/EmptyState';
import { SearchX } from 'lucide-react';
import { ADMIN_QUERY_OPTIONS, adminKeys } from './adminQueries';
import { useAdminSearch } from './useAdminSearch';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

type Scope = 'admin' | 'user';

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'admin', label: 'Admin actions' },
  { value: 'user', label: 'User activity' },
];

const EXAMPLE_LINE = 'Try: actor:asir · user:sam · action:festival.* · after:2026-10-01';

function downloadCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `festie-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Audit log viewer with qualifier search, pagination and CSV export
 */
export default function AdminAudit() {
  const [search, setAdminSearch] = useAdminSearch();
  const q = search.q ?? '';
  const [text, setText] = useState(q);
  const [scope, setScope] = useState<Scope>('admin');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { toast } = useToast();

  // Cursor state belongs to one scope+query pair; a different pair starts again at page one.
  const filterKey = `${scope}|${q}`;
  const [cursors, setCursors] = useState<{ key: string; stack: (string | null)[]; current: string | null }>({
    key: filterKey,
    stack: [],
    current: null,
  });
  const { stack, current } = cursors.key === filterKey ? cursors : { stack: [], current: null };

  const commitQuery = (value: string) => {
    const next = value.trim();
    if (next === q) return;
    setAdminSearch({ tab: 'audit', ...(next && { q: next }) }, { replace: true });
  };

  // Follow external URL changes (Back, chip removal, shared link); keep typed spacing when it is the same query.
  useEffect(() => {
    setText((t) => (t.trim() === q ? t : q));
  }, [q]);

  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(() => commitQuery(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps -- debounce fires only on typing

  const parsed = parseAuditQuery(q);
  // While the query has errors, keep asking for the last good filters so nothing refetches.
  const goodFilters = useRef<AuditQueryFilters>({});
  if (parsed.errors.length === 0) goodFilters.current = parsed.filters;
  const filters = { scope, ...goodFilters.current };

  const { data, error, isError, isFetching, refetch } = useQuery({
    queryKey: adminKeys.audit(filters, current),
    queryFn: () => fetchAuditPage({ ...filters, limit: PAGE_SIZE, cursor: current }),
    ...ADMIN_QUERY_OPTIONS,
    placeholderData: keepPreviousData,
  });

  const goNext = () => {
    if (!data?.nextCursor) return;
    setCursors({ key: filterKey, stack: [...stack, current], current: data.nextCursor });
  };

  const goPrev = () => {
    if (stack.length === 0) return;
    setCursors({ key: filterKey, stack: stack.slice(0, -1), current: stack[stack.length - 1] ?? null });
  };

  const runExport = async () => {
    setExporting(true);
    try {
      const result = await exportAuditCsv(filters);
      downloadCsv(result.csv);
      toast(
        result.capped
          ? 'Exported the newest 1,000 rows. Narrow the filters to export older rows.'
          : `Exported ${result.rows} rows.`,
        'success',
      );
    } catch {
      toast("Couldn't export the audit log. Try again.", 'error');
    } finally {
      setExporting(false);
    }
  };

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const hasFilters = parsed.tokens.length > 0;
  const from = stack.length * PAGE_SIZE + 1;
  const to = stack.length * PAGE_SIZE + entries.length;

  return (
    <div className="space-y-6" aria-busy={isFetching}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Audit log scope" className="inline-flex rounded-lg border border-glass-border overflow-hidden">
          {SCOPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => setScope(option.value)}
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
        <div className="flex flex-col items-start sm:items-end gap-1">
          <button
            type="button"
            onClick={runExport}
            disabled={exporting}
            className="px-4 py-2 min-h-11 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <span className="text-xs text-text-muted">Exports the rows that match your filters, up to 1,000.</span>
        </div>
      </div>

      {/* Search */}
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-3">
        <label htmlFor="audit-search" className="type-label text-text-primary block">
          Search the audit log
        </label>
        <input
          id="audit-search"
          type="text"
          placeholder="actor:asir action:festival.* after:2026-10-01"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitQuery(text);
          }}
          className="w-full px-3 py-2 min-h-11 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        />
        {parsed.errors.length > 0 && (
          <div role="alert" className="text-sm text-accent-coral space-y-1">
            {parsed.errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        )}
        {parsed.tokens.length === 0 ? (
          <p className="text-xs text-text-muted">{EXAMPLE_LINE}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {parsed.tokens.map((token) => (
              <li
                key={token.raw}
                className="inline-flex items-center gap-1 pl-3 rounded-full bg-accent-aqua/20 text-accent-aqua text-sm"
              >
                {token.raw}
                <button
                  type="button"
                  aria-label={`Remove filter ${token.raw}`}
                  onClick={() => commitQuery(removeAuditQueryToken(q, token.raw))}
                  className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-full hover:bg-accent-aqua/20"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div role="group" aria-label="Filter by action type" className="flex flex-wrap gap-2">
          {AUDIT_ACTION_FILTERS.map((chip) => {
            const active = (parsed.filters.action ?? '') === chip.prefix;
            return (
              <button
                key={chip.label}
                type="button"
                aria-pressed={active}
                onClick={() => commitQuery(setAuditQueryAction(q, chip.prefix))}
                className={`px-4 py-2 min-h-11 rounded-full text-sm font-medium transition-colors ${
                  active ? 'bg-accent-aqua/20 text-accent-aqua' : 'bg-bg-primary text-text-muted hover:bg-bg-card/80'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Entries */}
      {isError && !data ? (
        <EmptyState
          icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
          title="Couldn't load the audit log"
          description={mapErrorToUserMessage(error, 'Check your connection, then try again.')}
          cta={{ label: 'Retry', onClick: () => void refetch() }}
        />
      ) : !data ? (
        <div className="text-center py-12 text-text-muted">Loading audit log…</div>
      ) : entries.length === 0 ? (
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
            {entries.map((entry) => {
              const changes = describeAuditChanges(entry.details);
              const open = expandedId === entry.id;
              return (
                <div
                  key={entry.id}
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  className="px-6 py-4 hover:bg-bg-primary/20 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(open ? null : entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedId(open ? null : entry.id);
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium text-text-primary">
                        {auditActionLabel(entry.action)}
                        {entry.status !== 'success' && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral text-xs">
                            Failed
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted mt-1">
                        {[entry.actorUsername ?? 'System', entry.targetLabel, timeAgoFromIso(entry.createdAt)]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <div className="text-xl text-text-muted ml-4">{open ? '−' : '+'}</div>
                  </div>

                  {open && (
                    <div className="mt-4 pt-4 border-t border-glass-border space-y-3">
                      {changes.length > 0 && (
                        <table className="w-full text-sm text-left">
                          <thead>
                            <tr className="text-text-muted">
                              <th className="py-1 pr-4">Field</th>
                              <th className="py-1 pr-4">Before</th>
                              <th className="py-1">After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {changes.map((c) => (
                              <tr key={c.field}>
                                <td className="py-1 pr-4 text-text-primary">{c.label}</td>
                                <td className="py-1 pr-4 text-text-secondary">{c.before}</td>
                                <td className="py-1 text-text-secondary">{c.after}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {entry.requestId && <p className="text-xs text-text-muted">Request ID: {entry.requestId}</p>}
                      {entry.details && (
                        <details>
                          <summary className="text-xs text-text-muted cursor-pointer">Raw details</summary>
                          <pre className="bg-bg-primary/30 p-3 rounded-lg text-xs text-text-secondary overflow-x-auto mt-2">
                            {JSON.stringify(entry.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {entries.length > 0 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={goPrev}
            disabled={stack.length === 0}
            className="px-4 py-2 rounded-lg bg-bg-card border border-glass-border text-text-primary hover:bg-bg-card/80 disabled:opacity-50 transition-colors text-sm font-medium"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-muted text-sm">Page {stack.length + 1}</span>
          <button
            onClick={goNext}
            disabled={!data?.nextCursor}
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
