import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAdminAnalytics } from '@festie/shared/services/admin';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { analyticsQuestions, analyticsScopeLine, formatDate, funnelSteps, timeAgoFromIso } from '@festie/shared/utils';
import EmptyState from '../ui/EmptyState';
import PickDistribution from './PickDistribution';
import TopSets from './TopSets';
import FestivalStats from './FestivalStats';
import { ADMIN_QUERY_OPTIONS, adminKeys } from './adminQueries';
import { useAdminSearch } from './useAdminSearch';

/**
 * Analytics dashboard: named questions, funnel and true totals.
 */
export default function AdminAnalytics() {
  const [{ festival }, setAdminSearch] = useAdminSearch();
  const { data, error, isError, isPending, refetch } = useQuery({
    queryKey: adminKeys.analytics(festival),
    queryFn: () => fetchAdminAnalytics(festival),
    ...ADMIN_QUERY_OPTIONS,
  });

  if (isPending) {
    return <div className="text-center py-12 text-text-muted">Loading analytics…</div>;
  }

  if (isError || !data) {
    return (
      <EmptyState
        title="Couldn't load analytics"
        description={mapErrorToUserMessage(error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void refetch() }}
      />
    );
  }

  const selectFestival = (id?: string) => setAdminSearch({ tab: 'analytics', ...(id && { festival: id }) });

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <label htmlFor="analytics-festival" className="type-label text-text-primary block">
          Festival
        </label>
        <select
          id="analytics-festival"
          value={festival ?? ''}
          onChange={(e) => selectFestival(e.target.value || undefined)}
          className="w-full sm:w-auto min-h-11 px-3 py-2 rounded-lg bg-bg-primary border border-glass-border text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
        >
          <option value="">All festivals</option>
          {data.festivalStats.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <p className="text-sm text-text-muted">{analyticsScopeLine(data)}</p>
      </div>

      <ul className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {analyticsQuestions(data).map((q) => (
          <li key={q.id} className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
            <div className="type-label text-text-muted mb-1">{q.question}</div>
            <div className="text-text-primary">{q.answer}</div>
          </li>
        ))}
      </ul>

      <div>
        <h2 className="type-heading text-text-primary mb-1">Where do people drop off?</h2>
        <p className="text-xs text-text-muted mb-4">
          Each step counts people. A step can be larger than the one before it, for example when someone joins a crew
          before picking.
        </p>
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 space-y-4">
          {funnelSteps(data).map((step) => (
            <div key={step.label}>
              <div className="flex justify-between text-sm text-text-primary mb-1">
                <span>{step.label}</span>
                <span>
                  {step.count} · {step.pctOfStart} of sign-ups
                </span>
              </div>
              <div className="h-2 rounded-full bg-bg-primary/30 overflow-hidden">
                <div
                  style={{ width: `${Math.min(100, parseInt(step.pctOfStart, 10) || 0)}%` }}
                  className="h-full bg-accent-aqua"
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <PickDistribution
        must={data.pickDistribution.must}
        want={data.pickDistribution.want}
        maybe={data.pickDistribution.maybe}
        total={data.totals.picks}
      />

      <TopSets sets={data.topSets} />

      <FestivalStats stats={data.festivalStats} onSelect={(id) => selectFestival(id)} />

      {/* Active Users */}
      {data.activeUsers.length > 0 && (
        <div>
          <h2 className="type-heading text-text-primary mb-4">Most recently active people (latest 50)</h2>
          <div
            role="region"
            tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- intentional: keeps this overflow-x-auto table keyboard-scrollable; rule only exempts role=tabpanel
            aria-label="Recently active people table"
            className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Most recently active people</caption>
              <thead>
                <tr className="text-left text-text-muted border-b border-glass-border">
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2 text-right">Festival plans</th>
                  <th className="px-4 py-2 text-right">Total picks</th>
                  <th className="px-4 py-2 text-right">Last active</th>
                </tr>
              </thead>
              <tbody>
                {data.activeUsers.map((u) => (
                  <tr key={u.id} className="border-b border-glass-border last:border-0">
                    <td className="px-4 py-2 text-text-primary">{u.username}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.profileCount}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{u.totalPicks}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{timeAgoFromIso(u.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Crews */}
      {data.crews.length > 0 && (
        <div>
          <h2 className="type-heading text-text-primary mb-4">Largest crews (top 20)</h2>
          <div
            role="region"
            tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- intentional: keeps this overflow-x-auto table keyboard-scrollable; rule only exempts role=tabpanel
            aria-label="Crews table"
            className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">Largest crews</caption>
              <thead>
                <tr className="text-left text-text-muted border-b border-glass-border">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Festival</th>
                  <th className="px-4 py-2 text-right">Members</th>
                  <th className="px-4 py-2 text-right">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.crews.map((c) => (
                  <tr key={c.id} className="border-b border-glass-border last:border-0">
                    <td className="px-4 py-2 text-text-primary">{c.name}</td>
                    <td className="px-4 py-2 text-text-muted">{c.festivalName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{c.memberCount}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data.generatedAt && (
        <div className="text-xs text-text-muted text-right">
          Generated at {new Date(data.generatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
