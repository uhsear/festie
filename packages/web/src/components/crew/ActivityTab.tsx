import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api, parseActivityPage, useCrewStore, useFestivalStore, resolveFestivalTimeZone } from '@festie/shared';
import { useLiveLocationStore } from '@festie/shared/stores/liveLocationStore';
import type { CrewActivityEntry } from '@festie/shared/types';
import { timeAgo, describeCrewActivity, visibleCrewActivity } from '@festie/shared/utils';
import EmptyState from '../ui/EmptyState';
import Avatar from '../ui/Avatar';
import Skeleton from '../ui/Skeleton';
import Button from '../ui/Button';
import { Activity } from 'lucide-react';

interface Props {
  crewId: string;
}

interface ActivityPage {
  items: CrewActivityEntry[];
  nextCursor: string | null;
}

// The server returns { items, nextCursor }; event type labels come from CREW_ACTIVITY_LABELS.
// crew:activity (lib/emitter.ts) pushes new events and useCrewQuerySink invalidates
// ['crew-activity', crewId] on it (the 'pages' key below shares that prefix). The 30s
// poll stays as the safety net.
export default function ActivityTab({ crewId }: Props) {
  const navigate = useNavigate();
  const members = useCrewStore((s) => s.activeCrew?.members);
  const timeZone = useFestivalStore((s) => resolveFestivalTimeZone(s.currentFestival));
  const sosByUser = useLiveLocationStore((s) => s.sosByUser);
  const activeSosUserIds = React.useMemo(
    () => new Set(Object.values(sosByUser).filter((e) => e.crewId === crewId).map((e) => e.userId)),
    [sosByUser, crewId],
  );
  const { data, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['crew-activity', crewId, 'pages'],
    queryFn: async ({ pageParam }): Promise<ActivityPage> => {
      const url = `/crews/${crewId}/activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`;
      const res = await api.get<unknown>(url);
      const cursor = (res as { nextCursor?: unknown } | null)?.nextCursor;
      return { items: parseActivityPage(res), nextCursor: typeof cursor === 'string' && cursor ? cursor : null };
    },
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!crewId,
    refetchInterval: 30_000,
  });
  const items = visibleCrewActivity(data?.pages.flatMap((p) => p.items) ?? []);

  if (isLoading) {
    return (
      <div className="px-4 space-y-2">
        <Skeleton variant="text" />
        <Skeleton variant="text" />
        <Skeleton variant="text" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<Activity className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load activity"
          description="Something went wrong loading crew activity."
          cta={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="px-4">
        <EmptyState
          icon={<Activity className="w-12 h-12" aria-hidden="true" />}
          title="No activity yet"
          description="Crew events will appear here as they happen."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4">
      {items.map((it, idx) => {
        const { verb, detail, action } = describeCrewActivity(it, timeZone, { members, activeSosUserIds });
        return (
          <div
            key={it.id}
            className="crew-activity-rail stagger-item p-3 rounded-lg bg-bg-card border border-border flex items-start gap-3 animate-[card-in_220ms_var(--ease-out,ease-out)_both] motion-reduce:!animate-none"
            style={{ '--i': Math.min(idx, 20) } as React.CSSProperties}
          >
            <Avatar name={it.username || 'User'} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-primary">
                <span className="font-semibold">{it.username}</span> <span className="text-text-secondary">{verb}</span>
                {detail && <span className="text-text-secondary">: {detail}</span>}
              </div>
              <div className="text-xs text-text-muted mt-0.5">{timeAgo(new Date(it.created_at).getTime())}</div>
              {action === 'show-sos' && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  onClick={() => void navigate({ to: '/crew', search: { sos: it.user_id } })}
                >
                  Show on map
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {hasNextPage && (
        <Button variant="secondary" fullWidth isLoading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
          Show older
        </Button>
      )}
    </div>
  );
}
