import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import { withReauth } from '@festie/shared/services/admin';
import { pluralize } from '@festie/shared/utils/format';
import {
  createOrganization,
  type AdminOrganization,
  type OrgKind,
} from '@festie/shared/services/adminOrganizations';
import { useToast } from '../../lib/toastContext';
import { useReauthPrompt } from '../../hooks/useReauthPrompt';
import EmptyState from '../ui/EmptyState';
import { cn } from '../../lib/utils';
import { INPUT_CLASS } from './adminStyles';
import { adminKeys, useOrganizations, useReviewQueue } from './adminQueries';
import AdminOrganizationDetail from './AdminOrganizationDetail';
import AdminReviewQueue from './AdminReviewQueue';
import AdminArtistSuggestions from './AdminArtistSuggestions';

type Section = 'organizations' | 'review' | 'held' | 'artists';

const STATUS_FILTERS = [
  { value: '', label: 'All organizations' },
  { value: 'pending', label: 'Waiting for activation' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
] as const;

const KINDS: ReadonlyArray<{ value: OrgKind; label: string }> = [
  { value: 'venue', label: 'Venue' },
  { value: 'promoter', label: 'Promoter' },
  { value: 'other', label: 'Other' },
];

export const orgStatusLabel = (status: string) =>
  status === 'pending' ? 'Waiting for activation' : status === 'active' ? 'Active' : 'Suspended';

const buttonClass =
  'inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-accent-aqua text-bg-primary text-sm font-medium hover:opacity-80 transition-opacity disabled:opacity-50';

/**
 * The Organizations tab: create organizations, add members by email, verify and suspend, and decide the
 * review queue and the held attendee alerts (plan-v3 section 7).
 */
export default function AdminOrganizations() {
  const queryClient = useQueryClient();
  const { toast, toastError } = useToast();
  const { askPassword, reauthDialog } = useReauthPrompt();
  const orgs = useOrganizations();
  const queue = useReviewQueue();
  const [section, setSection] = useState<Section>('organizations');
  const [openId, setOpenId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [ownerless, setOwnerless] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<OrgKind>('venue');
  const [website, setWebsite] = useState('');
  const [creating, setCreating] = useState(false);

  const requestCount = queue.data?.requests.length;
  const heldCount = queue.data?.held.length;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    try {
      const created = await createOrganization({ name: name.trim(), kind, website: website.trim() || null });
      toast(`${created.name} is created. Add its owner by email, then activate it.`, 'success');
      setName('');
      setWebsite('');
      await queryClient.invalidateQueries({ queryKey: adminKeys.organizations });
      setOpenId(created.id);
    } catch (err) {
      toastError(err, "Couldn't create the organization. Try again.");
    } finally {
      setCreating(false);
    }
  };

  if (openId) {
    return (
      <>
        <AdminOrganizationDetail
          organizationId={openId}
          onBack={() => setOpenId(null)}
          reauth={(run) => withReauth(run, askPassword, { retryWrongPassword: true })}
        />
        {reauthDialog}
      </>
    );
  }

  const tabClass = (active: boolean) =>
    cn(
      'px-3 py-1.5 min-h-11 rounded-md text-sm font-medium transition-colors',
      active ? 'bg-accent-aqua/20 text-accent-aqua' : 'text-text-secondary hover:text-text-primary',
    );

  const visible = (orgs.data ?? []).filter(
    (o: AdminOrganization) => (!status || o.status === status) && (!ownerless || o.ownerCount === 0),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Organizations sections">
        <button type="button" aria-pressed={section === 'organizations'} onClick={() => setSection('organizations')} className={tabClass(section === 'organizations')}>
          Organizations
        </button>
        <button type="button" aria-pressed={section === 'review'} onClick={() => setSection('review')} className={tabClass(section === 'review')}>
          Review queue{requestCount ? ` (${requestCount})` : ''}
        </button>
        <button type="button" aria-pressed={section === 'held'} onClick={() => setSection('held')} className={tabClass(section === 'held')}>
          Held alerts{heldCount ? ` (${heldCount})` : ''}
        </button>
        <button type="button" aria-pressed={section === 'artists'} onClick={() => setSection('artists')} className={tabClass(section === 'artists')}>
          Artist suggestions
        </button>
      </div>

      {(section === 'review' || section === 'held') && <AdminReviewQueue section={section} queue={queue} />}
      {section === 'artists' && <AdminArtistSuggestions />}

      {section === 'organizations' && (
        <>
          <form onSubmit={create} className="space-y-3 rounded-lg border border-glass-border bg-bg-card/60 p-4" aria-label="Create an organization">
            <h2 className="type-heading text-text-primary">Create an organization</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Organization name
                <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} className={INPUT_CLASS} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Kind
                <select value={kind} onChange={(e) => setKind(e.target.value as OrgKind)} className={INPUT_CLASS}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Website (https, optional)
                <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" maxLength={2048} className={INPUT_CLASS} />
              </label>
            </div>
            <button type="submit" disabled={creating || name.trim().length < 2} className={buttonClass}>
              {creating ? 'Creating…' : 'Create organization'}
            </button>
          </form>

          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-text-muted">
                Show
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={INPUT_CLASS}>
                  {STATUS_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm text-text-primary">
                <input type="checkbox" checked={ownerless} onChange={(e) => setOwnerless(e.target.checked)} />
                Only organizations with no owner
              </label>
            </div>

            {orgs.isPending ? (
              <div role="status" className="py-12 text-center text-text-muted">
                Loading organizations…
              </div>
            ) : orgs.isError ? (
              <EmptyState
                icon={<SearchX className="h-9 w-9" aria-hidden="true" />}
                title="Couldn't load organizations"
                description={mapErrorToUserMessage(orgs.error, 'Check your connection, then try again.')}
                cta={{ label: 'Retry', onClick: () => void orgs.refetch() }}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<SearchX className="h-9 w-9" aria-hidden="true" />}
                title="No organizations found"
                description="Create one above, or change the filter."
              />
            ) : (
              <ul className="list-none space-y-3 p-0">
                {visible.map((org) => (
                  <li key={org.id} className="space-y-1 rounded-lg border border-glass-border bg-bg-card/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenId(org.id)}
                        className="min-h-11 text-left text-base font-semibold text-text-primary underline-offset-2 hover:underline"
                      >
                        {org.name}
                      </button>
                      <span className="rounded-full bg-accent-amber/20 px-2 py-0.5 text-xs font-semibold text-accent-amber">
                        {orgStatusLabel(org.status)}
                      </span>
                      {org.verifiedAt && (
                        <span className="rounded-full bg-accent-aqua/20 px-2 py-0.5 text-xs font-semibold text-accent-aqua">Verified</span>
                      )}
                    </div>
                    <p className="text-xs text-text-muted">
                      {org.kind}. {pluralize(org.memberCount ?? 0, 'member')}, {org.pendingCount ?? 0} waiting to join, {pluralize(org.festivalCount ?? 0, 'festival')}
                      {org.ownerCount === 0 ? '. No owner yet.' : '.'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      {reauthDialog}
    </div>
  );
}
