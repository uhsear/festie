import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAdminGrowth } from '@festie/shared/services/admin';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { summarizeGrowth, type GrowthTotal } from '@festie/shared/utils';
import { ADMIN_QUERY_OPTIONS, adminKeys } from './adminQueries';

function TotalsList({ title, rows, empty }: { title: string; rows: GrowthTotal[]; empty: string }) {
  return (
    <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-4">
      <h3 className="type-label text-text-muted mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{empty}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.key} className="flex justify-between gap-3">
              <span className="text-text-primary truncate">{row.label}</span>
              <span className="tabular-nums text-text-muted">{row.total}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Read-only growth card: sign-ups by source, follows, people reached by news pushes and emails, and held pushes. */
export default function AdminGrowth() {
  const { data, error, isError, isPending } = useQuery({
    queryKey: adminKeys.growth,
    queryFn: () => fetchAdminGrowth(),
    ...ADMIN_QUERY_OPTIONS,
  });

  if (isPending) return <p className="text-sm text-text-muted">Loading growth…</p>;
  if (isError || !data) {
    return <p className="text-sm text-text-muted">Couldn&apos;t load growth. {mapErrorToUserMessage(error, 'Try again later.')}</p>;
  }

  const summary = summarizeGrowth(data);
  return (
    <div>
      <h2 className="type-heading text-text-primary mb-1">Growth, all festivals, last {data.days} days</h2>
      <p className="text-xs text-text-muted mb-4">
        Sign-up counts are a floor: mobile sign-ups and visitors who cleared storage carry no source. Follows are
        counted per festival, not by source.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TotalsList title="Sign-ups by source" rows={summary.signups} empty="No tagged sign-ups yet." />
        <TotalsList title="New follows by festival" rows={summary.newFollows} empty="No new follows." />
        <TotalsList title="Followers per festival (all time)" rows={summary.followers} empty="No followers yet." />
        <TotalsList title="People pushed news, by type" rows={summary.newsPushed} empty="No news pushes sent." />
        <TotalsList title="People emailed news, by type" rows={summary.newsEmailed} empty="No news emails sent." />
        <TotalsList title="People with a news push held, by type" rows={summary.newsHeld} empty="No news pushes held." />
      </div>
    </div>
  );
}
