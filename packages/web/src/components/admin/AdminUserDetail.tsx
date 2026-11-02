import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { fetchAdminUserDetail, type AdminUserDetail as Detail } from '@festie/shared/services/admin';
import { ApiClientError } from '@festie/shared/services/api';
import { maskEmail, timeAgoFromIso, PRIVATE_VIEW_NOTICE } from '@festie/shared/utils';
import { UserX } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Read-only support view of one user. Opening it writes an audit row on the server. */
export default function AdminUserDetail({ userId }: { userId: string }) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<{ message: string; notFound: boolean } | null>(null);
  const [reveal, setReveal] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchAdminUserDetail(userId)
      .then((d) => !cancelled && setDetail(d))
      .catch((err: unknown) => {
        if (cancelled) return;
        const notFound = err instanceof ApiClientError && err.status === 404;
        setError({ message: err instanceof Error ? err.message : 'Failed to load user', notFound });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const back = useCallback(() => navigate({ to: '/admin', search: { tab: 'users' } }), [navigate]);
  const backButton = (
    <Button type="button" variant="secondary" onClick={back} className="min-h-11">
      Back to users
    </Button>
  );

  if (error?.notFound) {
    return (
      <div className="space-y-4">
        {backButton}
        <EmptyState icon={<UserX className="w-9 h-9" aria-hidden="true" />} title="This user no longer exists." />
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4">
        {backButton}
        <div role="alert" className="text-accent-coral">
          {error.message}
        </div>
        <Button type="button" onClick={() => setAttempt((a) => a + 1)} className="min-h-11">
          Try again
        </Button>
      </div>
    );
  }
  if (!detail) return <div className="text-center py-12 text-text-muted">Loading user…</div>;

  const { user, festivals, crews, activity } = detail;
  const rows: Array<[string, React.ReactNode]> = [
    [
      'Email',
      <span key="email" className="flex items-center gap-2">
        <span>{user.email !== null && reveal ? user.email : maskEmail(user.email)}</span>
        {user.email !== null && (
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-pressed={reveal}
            aria-label={`${reveal ? 'Hide' : 'Show'} full email for ${user.username}`}
            className="px-2 min-h-11 rounded-md text-xs text-accent-aqua hover:bg-accent-aqua/10"
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        )}
      </span>,
    ],
    ['Email status', user.emailVerified ? 'Verified' : 'Not verified'],
    ['Joined', new Date(user.createdAt).toISOString().slice(0, 10)],
    ['Last active', user.lastActiveAt ? timeAgoFromIso(user.lastActiveAt) : 'No active session'],
    ['Public schedule', user.publicSchedule ? 'On' : 'Off'],
    ['Role', user.roles.includes('admin') ? 'Admin' : 'User'],
  ];

  return (
    <div className="space-y-6">
      {backButton}
      <div>
        <h2 className="type-heading text-text-primary">@{user.username}</h2>
        {user.displayName && <p className="text-text-secondary">{user.displayName}</p>}
        <p className="text-xs text-text-muted">{PRIVATE_VIEW_NOTICE}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-text-muted">{label}</dt>
            <dd className="text-text-primary">{value}</dd>
          </React.Fragment>
        ))}
      </dl>

      <section aria-label="Festivals" className="space-y-2">
        <h3 className="text-base font-semibold text-text-primary">Festivals ({festivals.length})</h3>
        {festivals.length === 0 ? (
          <p className="text-sm text-text-muted">Not in any festival yet.</p>
        ) : (
          <ul className="space-y-1 text-sm text-text-secondary">
            {festivals.map((f) => (
              <li key={`${f.festivalId}-${f.joinedAt}`}>
                {f.festivalName ?? 'Archived festival'} · {plural(f.picks, 'pick', 'picks')}
                {f.profileName ? ` · as ${f.profileName}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Crews" className="space-y-2">
        <h3 className="text-base font-semibold text-text-primary">Crews ({crews.length})</h3>
        {crews.length === 0 ? (
          <p className="text-sm text-text-muted">Not in any crew.</p>
        ) : (
          <ul className="space-y-1 text-sm text-text-secondary">
            {crews.map((c) => (
              <li key={c.id}>
                {c.name} · {c.festivalName ?? 'Archived festival'} · {c.role === 'owner' ? 'Owner' : 'Member'} ·{' '}
                {plural(c.memberCount, 'member', 'members')}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Recent activity" className="space-y-2">
        <h3 className="text-base font-semibold text-text-primary">Recent activity</h3>
        {activity.length === 0 ? (
          <p className="text-sm text-text-muted">No activity in the last 90 days.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {activity.map((a) => (
              <li key={a.id}>
                <div className="text-text-primary">{a.friendlyAction}</div>
                <div className="text-xs text-text-muted">
                  {a.actorUsername ?? 'system'} · {a.targetLabel ?? '—'} · {timeAgoFromIso(a.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
