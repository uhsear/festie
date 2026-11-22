// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { CalendarPlus } from 'lucide-react';
import { selectMyPicks, useFestivalStore } from '@festie/shared/stores';
import { fetchCalendarLinks } from '@festie/shared/services';
import { buildPicksIcsExport, describeIcsExport } from '@festie/shared/utils';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { useToast } from '../../lib/toastContext';
import { saveBlob } from '../../lib/downloadExport';

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
  const myPicks = useFestivalStore(selectMyPicks);
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
    if (!currentFestival || !myPicks) return;
    const result = buildPicksIcsExport({
      festival: {
        id: currentFestival.id,
        name: currentFestival.name,
        location: currentFestival.location,
        timeZone: currentFestival.timeZone,
      },
      sets,
      stages,
      picks: myPicks,
      notes: currentProfile?.notes,
      reminders: currentProfile?.reminders,
    });
    const safeName = (currentFestival.name || 'festival').replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
    saveBlob(new Blob([result.ics], { type: 'text/calendar;charset=utf-8' }), `${safeName}_picks.ics`);
    toast(describeIcsExport(result), 'success');
    setOpen(false);
  };

  // Subscribe needs an account (the feed is keyed to a profile); the file export works from the picks on this device.
  if (!currentProfile) {
    return (
      <Button variant="secondary" size="sm" type="button" aria-label="Download picks as a calendar file" onClick={download}>
        <CalendarPlus className="w-4 h-4" aria-hidden="true" />
        Download .ics
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        aria-label="Add picks to calendar"
        onClick={() => setOpen(true)}
      >
        <CalendarPlus className="w-4 h-4" aria-hidden="true" />
        Add to calendar
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setLinks(null);
        }}
        title="Add to calendar"
        description="Subscribe keeps your calendar up to date when set times change. Download once saves a file that does not update."
      >
        {links ? (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => {
                window.location.href = links.webcalUrl;
              }}
            >
              Apple Calendar or Outlook
            </Button>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => window.open(links.googleUrl, '_blank', 'noopener')}
            >
              Google Calendar
            </Button>
            <Button variant="secondary" size="sm" type="button" onClick={() => copyLink(links.httpsUrl)}>
              {copied ? 'Copied' : 'Copy calendar link'}
            </Button>
            <p className="text-xs text-text-muted">
              Anyone with this calendar link can see your picks. If it leaks, reset your links in Account.
            </p>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="sm" type="button">
                Done
              </Button>
            </RadixDialog.Close>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="primary" size="sm" type="button" onClick={subscribe} isLoading={busy}>
              Subscribe (stays up to date)
            </Button>
            <Button variant="secondary" size="sm" type="button" onClick={download}>
              Download once
            </Button>
            <RadixDialog.Close asChild>
              <Button variant="ghost" size="sm" type="button">
                Cancel
              </Button>
            </RadixDialog.Close>
          </div>
        )}
      </Dialog>
    </>
  );
}
