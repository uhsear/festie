import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { updateManageOrganization, type ManageOrganizationDetail } from '@festie/shared/services/organizer';
import { useToast } from '../../lib/toastContext';
import { INPUT_CLASS } from '../admin/adminStyles';
import { adminKeys } from '../admin/adminQueries';

interface Props {
  organization: ManageOrganizationDetail;
  /** An owner of an organization that is not suspended may edit. Everyone else reads. */
  canEdit: boolean;
}

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** The profile of the organization: name, the display name teammates and emails use, contact and website. */
export default function ManageOrgProfile({ organization, canEdit }: Props) {
  const queryClient = useQueryClient();
  const { toast, toastError } = useToast();
  const [name, setName] = useState(organization.name);
  const [displayName, setDisplayName] = useState(organization.displayName ?? '');
  const [contactEmail, setContactEmail] = useState(organization.contactEmail ?? '');
  const [website, setWebsite] = useState(organization.website ?? '');
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    return (
      <dl className="space-y-1 text-sm text-text-secondary">
        <div className="flex gap-2">
          <dt className="text-text-muted">Name</dt>
          <dd>{organization.name}</dd>
        </div>
        {organization.displayName && (
          <div className="flex gap-2">
            <dt className="text-text-muted">Display name</dt>
            <dd>{organization.displayName}</dd>
          </div>
        )}
        {organization.contactEmail && (
          <div className="flex gap-2">
            <dt className="text-text-muted">Contact</dt>
            <dd className="break-all">{organization.contactEmail}</dd>
          </div>
        )}
        {organization.website && (
          <div className="flex gap-2">
            <dt className="text-text-muted">Website</dt>
            <dd className="break-all">{organization.website}</dd>
          </div>
        )}
      </dl>
    );
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await updateManageOrganization(organization.id, {
        name: name.trim(),
        displayName: orNull(displayName),
        contactEmail: orNull(contactEmail),
        website: orNull(website),
      });
      toast('Organization saved.', 'success');
      await queryClient.invalidateQueries({ queryKey: adminKeys.manageOrganization(organization.id) });
      await queryClient.invalidateQueries({ queryKey: ['manage', 'me'] });
    } catch (err) {
      toastError(err, "Couldn't save the organization. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} aria-label="Organization profile" className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Name
        <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Display name
        <input minLength={2} maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} className={INPUT_CLASS} />
        <span>Teammates and emails use this instead of the name. Leave it empty to use the name.</span>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Contact email
        <input type="email" maxLength={254} value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={INPUT_CLASS} />
        <span>Where Festie writes to you about your festivals.</span>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">
        Website
        <input type="url" maxLength={2048} placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} className={INPUT_CLASS} />
      </label>
      <div className="md:col-span-2">
        <button type="submit" disabled={busy || name.trim().length < 2} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent-aqua px-4 text-sm font-medium text-bg-primary disabled:opacity-50">
          Save organization
        </button>
      </div>
    </form>
  );
}
