import React, { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Plus, SearchX } from 'lucide-react';
import { mapErrorToUserMessage } from '@festie/shared/services/api';
import {
  organizerFestivalStatus,
  organizerPublicLink,
  type ManageFestival,
  type ManageOrganization,
} from '@festie/shared/services/organizer';
import { LINEUP_SAMPLE_CSV } from '@festie/shared/utils/lineupImport';
import { useToast } from '../../lib/toastContext';
import { cn } from '../../lib/utils';
import EmptyState from '../ui/EmptyState';
import { downloadText } from '../admin/lineupImportShared';
import FestivalLinkQRDialog from './FestivalLinkQRDialog';

interface Props {
  query: UseQueryResult<ManageFestival[]>;
  organizations: ManageOrganization[];
  onOpen: (festivalId: string) => void;
  onNew: () => void;
  onDelete: (festivalId: string) => void;
}

const CHIP_CLASS = {
  draft: 'bg-accent-amber/20 text-accent-amber',
  review: 'bg-accent-amber/20 text-accent-amber',
  changes: 'bg-accent-coral/20 text-accent-coral',
  live: 'bg-accent-aqua/20 text-accent-aqua',
} as const;

const smallButton =
  'inline-flex items-center justify-center min-h-11 px-3 rounded-xl border border-glass-border text-sm text-text-primary hover:bg-bg-card transition-colors';

/** The festivals of the member's organizations, grouped by organization when there is more than one (plan-v3 5.1 step 6). */
export default function ManageFestivalList({ query, organizations, onOpen, onNew, onDelete }: Props) {
  const { toast } = useToast();
  const canCreate = organizations.some((o) => o.role === 'owner' && o.status !== 'suspended');
  const canImport = organizations.some((o) => o.role !== 'viewer' && o.status !== 'suspended');
  const festivals = (query.data ?? []).filter((f) => !f.deleted);
  const [qr, setQr] = useState<{ name: string; link: string } | null>(null);

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied.', 'success');
    } catch {
      toast('Copy failed. Select the link and copy it.', 'error');
    }
  };

  const renderRow = (festival: ManageFestival, org: ManageOrganization | undefined) => {
    const status = organizerFestivalStatus(festival, window.location.origin);
    const link = status.state === 'live' ? organizerPublicLink(festival.slug, window.location.origin) : null;
    // Only an owner deletes, and only a draft (plan-v3 5.5).
    const canDelete = org?.role === 'owner' && org.status !== 'suspended' && !festival.published;
    return (
      <li key={festival.id} className="rounded-xl border border-glass-border bg-bg-card/60 p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(festival.id)}
            className="min-h-11 text-left type-heading text-text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-aqua"
          >
            {festival.name}
          </button>
          <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', CHIP_CLASS[status.state])}>{status.chip}</span>
        </div>
        {festival.location && <p className="text-sm text-text-muted">{festival.location}</p>}
        <p className="text-sm text-text-secondary">{status.text}</p>
        <div className="flex flex-wrap items-center gap-2">
          {link && (
            <>
              <a href={link} target="_blank" rel="noreferrer" className="text-sm text-accent-aqua underline break-all">
                {link}
              </a>
              <button type="button" onClick={() => void copy(link)} className={smallButton} aria-label={`Copy link to ${festival.name}`}>
                Copy link
              </button>
              <button type="button" onClick={() => setQr({ name: festival.name, link })} className={smallButton} aria-label={`Show QR code for ${festival.name}`}>
                QR code
              </button>
            </>
          )}
          {canDelete && (
            <button type="button" onClick={() => onDelete(festival.id)} className={smallButton} aria-label={`Delete ${festival.name}`}>
              Delete draft
            </button>
          )}
        </div>
      </li>
    );
  };

  const banners = organizations.map((org) => {
    if (org.status === 'pending') {
      return (
        <p key={org.id} role="status" className="rounded-xl border border-glass-border p-3 text-sm text-text-secondary">
          {organizations.length > 1 ? `${org.name}: ` : ''}Festie is checking your organization. You can build drafts now. Uploads and Submit unlock when we approve you.
        </p>
      );
    }
    if (org.status === 'suspended') {
      return (
        <p key={org.id} role="alert" className="rounded-xl border border-accent-amber p-3 text-sm text-accent-amber">
          {organizations.length > 1 ? `${org.name}: ` : ''}Your organization&apos;s access is paused. Your live festivals stay visible to attendees.{' '}
          <a href="mailto:support@festie.us" className="underline">
            Contact Festie
          </a>
        </p>
      );
    }
    return null;
  });

  let body: React.ReactNode;
  if (query.isPending) body = <div className="text-center py-12 text-text-muted">Loading festivals…</div>;
  else if (query.isError) {
    body = (
      <EmptyState
        icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
        title="Couldn't load festivals"
        description={mapErrorToUserMessage(query.error, 'Check your connection, then try again.')}
        cta={{ label: 'Retry', onClick: () => void query.refetch() }}
      />
    );
  } else if (festivals.length === 0) {
    body = (
      <EmptyState
        icon={<SearchX className="w-9 h-9" aria-hidden="true" />}
        title="No festivals yet"
        description={canCreate ? 'Create a draft to get started. Only your team and Festie can see it.' : 'Your team has no festivals yet. An owner of your organization creates the first one.'}
      />
    );
  } else if (organizations.length > 1) {
    body = (
      <div className="space-y-6">
        {organizations.map((org) => {
          const mine = festivals.filter((f) => f.organizationId === org.id);
          return (
            <section key={org.id} aria-label={org.name} className="space-y-3">
              <h2 className="type-label text-text-primary">{org.name}</h2>
              {mine.length === 0 ? (
                <p className="text-sm text-text-muted">No festivals yet.</p>
              ) : (
                <ul className="list-none space-y-3 p-0">{mine.map((f) => renderRow(f, org))}</ul>
              )}
            </section>
          );
        })}
      </div>
    );
  } else {
    body = <ul className="list-none space-y-3 p-0">{festivals.map((f) => renderRow(f, organizations[0]))}</ul>;
  }

  return (
    <div className="space-y-4">
      {banners}
      {canCreate && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-11 rounded-xl bg-accent-aqua text-bg-primary hover:opacity-80 transition-opacity text-sm font-medium whitespace-nowrap"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            New festival
          </button>
        </div>
      )}
      {body}
      {canImport && (
        <p className="text-sm text-text-muted">
          Starting a lineup?{' '}
          <button type="button" className="inline-flex min-h-11 items-center text-accent-aqua underline" onClick={() => downloadText('festie-lineup-sample.csv', LINEUP_SAMPLE_CSV)}>
            Download a sample import file
          </button>
          .
        </p>
      )}
      {qr && <FestivalLinkQRDialog open onOpenChange={(open) => !open && setQr(null)} festivalName={qr.name} link={qr.link} />}
    </div>
  );
}
