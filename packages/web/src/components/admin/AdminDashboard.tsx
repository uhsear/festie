import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAdminDashboard } from '@festie/shared/services/admin';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  auditActionLabel,
  dashboardStatRows,
  describeHealth,
  healthDetailRows,
  timeAgoFromIso,
} from '@festie/shared/utils';
import { CircleCheck, CircleHelp, ClipboardList, Music, Tent, TriangleAlert, Users } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import { cn } from '../../lib/utils';
import { ADMIN_QUERY_OPTIONS, adminKeys } from './adminQueries';
import { useAdminSearch } from './useAdminSearch';

const STAT_ICONS = {
  users: <Users />,
  festivals: <Tent />,
  profiles: <ClipboardList />,
  picks: <Music />,
};

const HEALTH_ICONS = {
  ok: <CircleCheck className="w-5 h-5 text-accent-green shrink-0" aria-hidden="true" />,
  warn: <TriangleAlert className="w-5 h-5 text-accent-amber shrink-0" aria-hidden="true" />,
  unknown: <CircleHelp className="w-5 h-5 text-text-muted shrink-0" aria-hidden="true" />,
};

/**
 * Admin dashboard overview with stats, health, and recent activity
 */
export default function AdminDashboard() {
  const [, setAdminSearch] = useAdminSearch();
  const { data, error, isError, isPending, isFetching, refetch } = useQuery({
    queryKey: adminKeys.dashboard,
    queryFn: fetchAdminDashboard,
    ...ADMIN_QUERY_OPTIONS,
  });

  if (isPending) {
    return (
      <div className="space-y-6">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 bg-bg-card/30 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        title="Couldn't load the dashboard"
        description={mapErrorToUserMessage(error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void refetch() }}
      />
    );
  }

  const { stats, health, recentActivity } = data;
  const healthLine = describeHealth(health);

  return (
    <div className="space-y-8">
      {/* Stats Grid */}
      <div>
        <h2 className="type-heading text-text-primary mb-4">Statistics</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {dashboardStatRows(stats).map((card) => (
            <button
              key={card.key}
              type="button"
              aria-label={`${card.value} ${card.label}. Open ${card.target}.`}
              onClick={() => setAdminSearch({ tab: card.target })}
              className="text-left bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4 min-h-11 hover:bg-bg-card/80 transition-colors"
            >
              <div className={cn('mb-2 [&_svg]:w-6 [&_svg]:h-6 text-accent-aqua')} aria-hidden="true">
                {STAT_ICONS[card.key]}
              </div>
              <div className="text-3xl font-bold text-text-primary">{card.value}</div>
              <div className="text-sm text-text-primary mt-1">{card.label}</div>
              <div className="text-xs text-text-muted">{card.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Health */}
      <div>
        <h2 className="type-heading text-text-primary mb-4">Health</h2>
        <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6 space-y-4">
          <div className="flex items-center gap-3">
            {HEALTH_ICONS[healthLine.tone]}
            <p className="text-text-primary">{healthLine.text}</p>
          </div>
          {health && (
            <details>
              <summary className="cursor-pointer text-sm text-text-muted min-h-11 flex items-center">Details</summary>
              <p className="text-xs text-text-muted mb-3">This server process. A restart resets these numbers.</p>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                {healthDetailRows(health).map((row) => (
                  <div key={row.label}>
                    <dt className="text-xs text-text-muted">{row.label}</dt>
                    <dd className="text-sm text-text-primary">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          <a
            href="/api/v1/admin/status"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm text-accent-aqua underline"
          >
            Open the full status page
          </a>
        </div>
      </div>

      {/* Recent Activity */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="type-heading text-text-primary">Recent admin activity</h2>
          <button
            type="button"
            onClick={() => setAdminSearch({ tab: 'audit' })}
            className="px-4 py-2 min-h-11 rounded-lg text-sm font-medium text-accent-aqua hover:bg-accent-aqua/10 transition-colors"
          >
            See all
          </button>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-text-muted text-sm">No recent activity</p>
        ) : (
          <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-hidden">
            <div className="divide-y divide-glass-border">
              {recentActivity.slice(0, 10).map((activity) => (
                <div key={activity.id} className="px-6 py-4 hover:bg-bg-primary/20 transition-colors">
                  <div className="text-sm font-medium text-text-primary">{auditActionLabel(activity.action)}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {activity.actorUsername ?? 'System'} · {timeAgoFromIso(activity.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Refresh button */}
      <div className="flex justify-center pt-4">
        <button
          onClick={() => void refetch()}
          disabled={isFetching}
          className="px-6 py-2 min-h-11 rounded-lg bg-accent-aqua/20 text-accent-aqua hover:bg-accent-aqua/30 transition-colors text-sm font-medium border border-accent-aqua/30 disabled:opacity-60"
        >
          Refresh Dashboard
        </button>
      </div>
    </div>
  );
}
