import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { describeEngagementCount, fetchManageEngagement } from '@festie/shared/services/organizer';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import EmptyState from '../ui/EmptyState';

interface SetLike {
  id: string;
  artist?: string;
}

interface Props {
  festivalId: string;
  /** The festival's days, only to name the sets by artist. */
  days?: Array<{ sets?: SetLike[] }>;
}

/**
 * How many people picked each set, for a verified organization's own live festival (plan-v3 6.6). The server
 * sends nothing until 20 people joined and hides every count below 5, so this shows no single person.
 */
export default function ManageInterest({ festivalId, days }: Props) {
  const interest = useQuery({
    queryKey: ['manage', 'engagement', festivalId],
    queryFn: () => fetchManageEngagement(festivalId),
    retry: false,
  });
  const names = new Map<string, string>();
  for (const day of days ?? []) for (const set of day.sets ?? []) names.set(set.id, set.artist || set.id);

  if (interest.isPending) return <div className="py-4 text-text-muted">Loading interest…</div>;
  if (interest.isError) {
    return (
      <EmptyState
        title="Couldn't load interest"
        description={mapErrorToUserMessage(interest.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void interest.refetch() }}
      />
    );
  }
  const { available, minJoined, minCount, sets } = interest.data;
  const rows = Object.entries(sets);
  return (
    <section aria-label="Interest" className="space-y-3 rounded-lg border border-glass-border bg-bg-card/60 p-4">
      <h3 className="type-heading text-text-primary">Interest</h3>
      {!available ? (
        <p className="text-sm text-text-muted">
          Counts show once {minJoined} people have joined this festival. This protects the people who joined.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">Nobody has picked a set yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted">
              <th scope="col" className="py-1 pr-2 font-medium">
                Set
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Picks
              </th>
              <th scope="col" className="py-1 font-medium">
                Reminders
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([setId, counts]) => (
              <tr key={setId} className="border-t border-glass-border text-text-primary">
                <td className="py-1 pr-2">{names.get(setId) ?? setId}</td>
                <td className="py-1 pr-2">{describeEngagementCount(counts.picks, minCount)}</td>
                <td className="py-1">{describeEngagementCount(counts.reminders, minCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
