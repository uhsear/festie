import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { fetchManageMe } from '@festie/shared/services/organizer';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import AdminFestivals from '../components/admin/AdminFestivals';
import { useAdminSearch } from '../components/admin/useAdminSearch';
import ManageActivity from '../components/manage/ManageActivity';
import ManageTeam from '../components/manage/ManageTeam';
import { RenderErrorBoundary } from '../components/layout/RouteErrorBoundary';
import EmptyState from '../components/ui/EmptyState';
import { useToast } from '../lib/toastContext';

export default function ManagePage() {
  return (
    <RenderErrorBoundary name="manage">
      <ManagePageInner />
    </RenderErrorBoundary>
  );
}

/**
 * /manage: the festivals of the organizations the signed-in user belongs to (plan-v3 section 5).
 * GET /manage/me first claims every pending membership that matches the confirmed email, so a person
 * added before they had an account sees the organization on the first load.
 */
function ManagePageInner() {
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const { toast } = useToast();
  const [resending, setResending] = useState(false);
  // The organization the team screen and a new festival start from, and which screen is open. An open festival
  // or an import owns the page, so the tabs step aside until the member goes back to the list.
  const [orgId, setOrgId] = useState('');
  const [section, setSection] = useState<'festivals' | 'team' | 'activity'>('festivals');
  const [search] = useAdminSearch('/manage');
  const editing = !!(search.festival || search.view);
  const me = useQuery({ queryKey: ['manage', 'me'], queryFn: fetchManageMe, retry: false, refetchOnMount: 'always' });

  const resend = async () => {
    setResending(true);
    try {
      await resendVerification();
      toast(ACCOUNT_COPY.verifySent, 'success');
    } catch (err) {
      toast(mapErrorToUserMessage(err, 'Could not resend the email. Try again.'), 'error');
    } finally {
      setResending(false);
    }
  };

  let body: React.ReactNode;
  if (me.isPending) {
    body = <div className="text-center py-12 text-text-muted">Loading…</div>;
  } else if (me.isError) {
    body = (
      <EmptyState
        title="Couldn't load your organizations"
        description={mapErrorToUserMessage(me.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void me.refetch() }}
      />
    );
  } else if (me.data.organizations.length === 0) {
    body = (
      <EmptyState
        title="You are not part of an organization on Festie yet."
        description="If a venue added you, sign in with the email address they used."
        cta={{ label: 'Contact us', onClick: () => window.location.assign('mailto:support@festie.us') }}
      />
    );
  } else {
    const organizations = me.data.organizations;
    const current = organizations.find((o) => o.id === orgId) ?? organizations[0]!;
    body = (
      <>
        {!editing && (
          <div className="flex flex-wrap items-end justify-between gap-3">
            {organizations.length > 1 ? (
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Organization
                <select
                  value={current.id}
                  onChange={(e) => setOrgId(e.target.value)}
                  className="min-h-11 rounded-lg border border-glass-border bg-bg-card px-3 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-aqua"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="text-sm text-text-secondary">{current.name}</p>
            )}
            <div role="group" aria-label="Manage section" className="flex gap-2">
              {(current.role === 'owner' ? (['festivals', 'team', 'activity'] as const) : (['festivals', 'team'] as const)).map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={section === id}
                  onClick={() => setSection(id)}
                  className={`min-h-11 rounded-lg border px-4 text-sm font-medium ${section === id ? 'border-accent-aqua bg-accent-aqua/20 text-accent-aqua' : 'border-glass-border text-text-primary'}`}
                >
                  {id === 'festivals' ? 'Festivals' : id === 'team' ? 'Team' : 'Activity'}
                </button>
              ))}
            </div>
          </div>
        )}
        {section === 'team' && !editing ? (
          <ManageTeam key={current.id} organization={current} />
        ) : section === 'activity' && !editing && current.role === 'owner' ? (
          <ManageActivity key={current.id} organizationId={current.id} />
        ) : (
          <AdminFestivals mode="organizer" organizations={organizations} defaultOrgId={current.id} />
        )}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <h1 className="type-heading text-text-primary">Manage your festivals</h1>
      {me.data && !me.data.emailConfirmed && (
        <div role="status" className="flex flex-col gap-2 rounded-lg border border-accent-amber p-3 text-sm text-text-primary sm:flex-row sm:items-center sm:justify-between">
          <p>Confirm your email to see and edit your organization&apos;s festivals.</p>
          <button
            type="button"
            disabled={resending}
            onClick={() => void resend()}
            className="min-h-11 rounded-lg bg-accent-aqua px-4 py-2 text-sm font-medium text-bg-primary disabled:opacity-50"
          >
            Resend email
          </button>
        </div>
      )}
      {body}
    </div>
  );
}
