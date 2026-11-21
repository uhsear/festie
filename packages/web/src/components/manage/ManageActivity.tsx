import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchManageActivity, type ManageActivityEntry } from '@festie/shared/services/organizer';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import EmptyState from '../ui/EmptyState';

interface Props {
  organizationId: string;
}

/** "festival.publish_requested" becomes "Festival publish requested". */
export const describeAction = (action: string): string => {
  const words = action.replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const when = (iso: string) => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleString();
};

/** What happened in the organization lately: teammates by name, Festie staff as "Festie support" (owners only). */
export default function ManageActivity({ organizationId }: Props) {
  const activity = useQuery({
    queryKey: ['manage', 'activity', organizationId],
    queryFn: () => fetchManageActivity(organizationId),
    retry: false,
  });

  if (activity.isPending) return <div className="py-8 text-center text-text-muted">Loading activity…</div>;
  if (activity.isError) {
    return (
      <EmptyState
        title="Couldn't load the activity"
        description={mapErrorToUserMessage(activity.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void activity.refetch() }}
      />
    );
  }
  const entries: ManageActivityEntry[] = activity.data;
  if (entries.length === 0) return <p className="text-sm text-text-muted">Nothing has happened yet.</p>;
  return (
    <section aria-label="Activity" className="space-y-3">
      <p className="text-sm text-text-muted">The latest {entries.length} changes by your team and by Festie.</p>
      <ul className="list-none space-y-2 p-0">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-glass-border p-3">
            <p className="text-sm text-text-primary">{describeAction(entry.action)}</p>
            <p className="text-xs text-text-muted">
              {entry.actor} · {when(entry.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
