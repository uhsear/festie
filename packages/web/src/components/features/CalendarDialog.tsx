// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CalendarPlus, X } from 'lucide-react';
import { useFestivalStore } from '@festie/shared/stores';
import { fetchCalendarLinks } from '@festie/shared/services';
import { buildPicksIcsExport, describeIcsExport } from '@festie/shared/utils';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { useToast } from '../../lib/toastContext';

type CalendarLinks = Awaited<ReturnType<typeof fetchCalendarLinks>>;

/**
 * "Add to calendar" chooser: Subscribe (live feed) or Download once (.ics file).
 * Download is fully client-side over the loaded store data and exports ALL picks
 * across days, not just the selected day.
 */
export default function CalendarDialog() {
  const [open, setOpen] = useState(false);
  const [links, setLinks] = useState<CalendarLinks | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const currentProfile = useFestivalStore((s) => s.currentProfile);
  const sets = useFestivalStore((s) => s.sets);
  const stages = useFestivalStore((s) => s.stages);

  const subscribe = async () => {
    if (!currentFestival) return;
    setBusy(true);
    try {
      setLinks(await fetchCalendarLinks(currentFestival.id));
    } catch {
      toast("Couldn't get your calendar link. Check your connection and try again.", 'error');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async (httpsUrl: string) => {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Couldn't copy the link. Try again.", 'error');
    }
  };

  const download = () => {
    if (!currentFestival || !currentProfile) return;
    const result = buildPicksIcsExport({
      festival: {
        id: currentFestival.id,
        name: currentFestival.name,
        location: currentFestival.location,
      },
      sets,
      stages,
      picks: currentProfile.picks,
      notes: currentProfile.notes,
      reminders: currentProfile.reminders,
    });
    const safeName = (currentFestival.name || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
    const blob = new Blob([result.ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_picks.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(describeIcsExport(result), 'success');
    setOpen(false);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setLinks(null);
      }}
    >
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="sm" type="button" aria-label="Add picks to calendar">
          <CalendarPlus className="w-4 h-4" aria-hidden="true" />
          Add to calendar
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2
                     rounded-2xl bg-bg-card border border-border-light shadow-2xl p-5 space-y-4
                     data-[state=open]:animate-in data-[state=open]:zoom-in-95"
        >
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-bold text-text-primary">Add to calendar</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton label="Close" icon={<X className="w-5 h-5" />} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-text-secondary">
            Subscribe keeps your calendar up to date when set times change. Download once saves a file that does not
            update.
          </Dialog.Description>

          {links ? (
            <div className="flex flex-col gap-2">
              <Button variant="secondary" size="sm" type="button" onClick={() => { window.location.href = links.webcalUrl; }}>
                Apple Calendar or Outlook
              </Button>
              <Button variant="secondary" size="sm" type="button" onClick={() => window.open(links.googleUrl, '_blank', 'noopener')}>
                Google Calendar
              </Button>
              <Button variant="secondary" size="sm" type="button" onClick={() => copyLink(links.httpsUrl)}>
                {copied ? 'Copied' : 'Copy calendar link'}
              </Button>
              <p className="text-xs text-text-muted">
                Anyone with this calendar link can see your picks. If it leaks, reset your links in Account.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Button variant="primary" size="sm" type="button" onClick={subscribe} isLoading={busy}>
                Subscribe (stays up to date)
              </Button>
              <Button variant="secondary" size="sm" type="button" onClick={download}>
                Download once
              </Button>
              <Dialog.Close asChild>
                <Button variant="ghost" size="sm" type="button">
                  Cancel
                </Button>
              </Dialog.Close>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
