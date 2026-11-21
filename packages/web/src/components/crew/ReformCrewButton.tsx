import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { CalendarPlus } from 'lucide-react';
import { useCrewStore } from '@festie/shared/stores';
import { useFestivalDataStore } from '@festie/shared/stores';
import type { ReformCrewResponse } from '@festie/shared/types';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { inputBase } from '../../lib/styles';
import { useToast } from '../../lib/toastContext';

interface Props {
  /** The source crew being reformed. */
  crewId: string;
  /** The festival the source crew belongs to (excluded from the target list). */
  sourceFestivalId?: string;
  /** Crew name, for the dialog copy. */
  crewName: string;
}

/**
 * "Reform this crew for {festival}" — crews are festival-scoped, so this creates
 * a NEW crew in the chosen festival and brings the prior roster across (members
 * with a profile in the target are auto-added; the rest get the invite link).
 * Consent-safe: nobody is silently added to a festival they haven't joined.
 */
export default function ReformCrewButton({ crewId, sourceFestivalId, crewName }: Props) {
  const { toast, toastError } = useToast();
  const reformCrew = useCrewStore((s) => s.reformCrew);
  const festivals = useFestivalDataStore((s) => s.festivals);
  const loadFestivals = useFestivalDataStore((s) => s.loadFestivals);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('');
  const selectRef = useRef<HTMLSelectElement>(null);

  // Load the festival list lazily when the dialog opens.
  useEffect(() => {
    if (open && festivals.length === 0) loadFestivals().catch(() => {});
  }, [open, festivals.length, loadFestivals]);

  // Focus the festival select when the dialog opens (was autoFocus).
  useEffect(() => {
    if (open) selectRef.current?.focus();
  }, [open]);

  // Offer every festival except the source crew's own.
  const options = useMemo(() => festivals.filter((f) => f.id !== sourceFestivalId), [festivals, sourceFestivalId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    try {
      const res: ReformCrewResponse = await reformCrew(crewId, target);
      const added = res.reform?.autoAdded?.length ?? 0;
      const invited = res.reform?.invited?.length ?? 0;
      const fest = options.find((f) => f.id === target)?.name ?? 'the festival';
      toast(`Reformed for ${fest} — ${added} added, ${invited} to invite via the link.`, 'success');
      setOpen(false);
      setTarget('');
    } catch (err) {
      toastError(err, "Couldn't reform crew. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" fullWidth className="min-h-11" onClick={() => setOpen(true)}>
        <CalendarPlus className="w-4 h-4" aria-hidden="true" /> Reform this crew for another festival
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Reform crew"
        description={`Start “${crewName}” fresh for another festival. Members who’ve already joined that festival are added automatically; share the invite link with everyone else.`}
      >
        <form onSubmit={submit} className="space-y-3" {...(busy ? { 'aria-busy': true } : {})}>
          <select
            ref={selectRef}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
            aria-label="Target festival"
            className={`${inputBase} min-h-11`}
          >
            <option value="">Choose a festival…</option>
            {options.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {options.length === 0 && <p className="text-sm text-text-secondary">No other festivals available yet.</p>}
          <div className="flex gap-2">
            <RadixDialog.Close asChild>
              <Button variant="secondary" type="button" className="flex-1 min-h-11">
                Cancel
              </Button>
            </RadixDialog.Close>
            <Button
              type="submit"
              variant="primary"
              isLoading={busy}
              disabled={!target || busy}
              className="flex-1 min-h-11"
            >
              Reform
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
