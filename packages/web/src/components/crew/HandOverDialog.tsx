import { useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { crewCopy, memberAvatarUrl } from '@festie/shared/utils';
import type { CrewMember } from '@festie/shared/types';
import Avatar from '../ui/Avatar';
import Button from '../ui/Button';
import Dialog from '../ui/Dialog';

interface HandOverDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  crewName: string;
  candidates: CrewMember[];
  busy?: boolean;
  onConfirm: (newOwnerId: string) => void;
}

/** Owner leave: pick the next owner, then hand over and leave in one step. */
export default function HandOverDialog({
  open,
  onOpenChange,
  crewName,
  candidates,
  busy = false,
  onConfirm,
}: HandOverDialogProps) {
  const firstId = candidates[0]?.userId ?? null;
  const [selected, setSelected] = useState<string | null>(firstId);
  useEffect(() => {
    if (open) setSelected(firstId);
  }, [open, firstId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={crewCopy.handOverTitle(crewName)} description={crewCopy.handOverBody}>
      <div role="radiogroup" aria-label="New owner" className="space-y-1">
        {candidates.map((m) => {
          const displayName = m.name || m.username || 'User';
          return (
            <label
              key={m.userId}
              className="flex items-center gap-2.5 min-h-11 px-2 rounded-md border border-border bg-bg-card cursor-pointer"
            >
              <input
                type="radio"
                name="new-owner"
                value={m.userId}
                checked={selected === m.userId}
                onChange={() => setSelected(m.userId)}
                disabled={busy}
              />
              <Avatar name={displayName} image={memberAvatarUrl(m)} size="sm" />
              <span className="font-semibold text-text-primary truncate">{displayName}</span>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2">
        <RadixDialog.Close asChild>
          <Button variant="secondary" type="button" className="flex-1 min-h-11">
            Cancel
          </Button>
        </RadixDialog.Close>
        <Button
          type="button"
          variant="primary"
          isLoading={busy}
          disabled={!selected || busy}
          onClick={() => selected && onConfirm(selected)}
          className="flex-1 min-h-11"
        >
          {crewCopy.handOverConfirm}
        </Button>
      </div>
    </Dialog>
  );
}
