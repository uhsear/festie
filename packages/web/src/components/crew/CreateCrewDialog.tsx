import React, { useEffect, useId, useMemo, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useCrewStore, useFestivalStore } from '@festie/shared/stores';
import { useCreateCrew } from '@festie/shared/hooks';
import { crewCapState, crewCopy, crewFestivalChoices, festivalLabel } from '@festie/shared/utils';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';
import { inputBase } from '../../lib/styles';
import { useToast } from '../../lib/toastContext';

interface CreateCrewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** New-crew form. A crew belongs to one festival, so the festival is part of the form. */
export default function CreateCrewDialog({ open, onOpenChange }: CreateCrewDialogProps) {
  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const loadFestivals = useFestivalStore((s) => s.loadFestivals);
  const crews = useCrewStore((s) => s.crews);
  const createCrew = useCreateCrew();
  const { toastError } = useToast();
  const uid = useId();

  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPicked(null);
    if (festivals.length === 0) loadFestivals().catch(() => {});
    // Reset only when the dialog opens.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const choices = useMemo(() => crewFestivalChoices(festivals, currentFestival?.id), [festivals, currentFestival?.id]);
  const chosen = choices.find((f) => f.id === picked) ?? choices[0];
  const cap = crewCapState(crews, chosen?.id);
  const trimmed = name.trim();
  const canCreate = !!chosen && !cap.atCap && trimmed.length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen || !canCreate) return;
    setBusy(true);
    try {
      await createCrew(trimmed, chosen.id);
      onOpenChange(false);
    } catch (err) {
      toastError(err, useCrewStore.getState().error || "Couldn't create crew. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New crew">
      <form onSubmit={submit} className="space-y-3" {...(busy ? { 'aria-busy': true } : {})}>
        <p className="text-sm text-text-secondary">
          {chosen ? crewCopy.createFor(festivalLabel(chosen)) : crewCopy.pickFestivalFirst}
        </p>
        {choices.length >= 2 && (
          <div className="space-y-1">
            <label htmlFor={`${uid}-festival`} className="text-xs font-semibold text-text-muted">
              Festival
            </label>
            <select
              id={`${uid}-festival`}
              value={chosen?.id ?? ''}
              onChange={(e) => setPicked(e.target.value)}
              disabled={busy}
              className={`${inputBase} min-h-11`}
            >
              {choices.map((f) => (
                <option key={f.id} value={f.id}>
                  {festivalLabel(f)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor={`${uid}-name`} className="text-xs font-semibold text-text-muted">
            Crew name
          </label>
          <input
            id={`${uid}-name`}
            type="text"
            value={name}
            maxLength={60}
            placeholder="Sunset Squad"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            className={`${inputBase} min-h-11`}
          />
          <p className="text-xs text-text-muted">{crewCopy.createHelper}</p>
        </div>
        {cap.text && (
          <p role="status" className="text-sm text-text-secondary">
            {cap.text}
          </p>
        )}
        <div className="flex gap-2">
          <RadixDialog.Close asChild>
            <Button variant="secondary" type="button" className="flex-1 min-h-11">
              Cancel
            </Button>
          </RadixDialog.Close>
          <Button type="submit" variant="primary" disabled={!canCreate} className="flex-1 min-h-11">
            {busy ? 'Creating…' : 'Create crew'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
