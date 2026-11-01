import React, { useEffect, useState } from 'react';
import { useCrewStore, isPending, writeOutcomeMessage } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import IconButton from '../ui/IconButton';
import SyncMarker from './SyncMarker';
import { useUndoableRemove } from './useUndoableRemove';
import { Backpack, Check, Plus, Trash2, X } from 'lucide-react';

interface Props {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

/**
 * Crew packing board (M2 logistics) — a shared "who's bringing what" checklist.
 * Offline-native: reads/writes go through the crewStore, so an item created with
 * no signal renders optimistically and reconciles when the queued POST replays
 * (same pattern as polls). Claiming an item flips `claimed` + sets `brought_by`
 * to the current user; un-claiming clears both.
 */
export default function PackingTab({ crewId, currentUserId, isOwner }: Props) {
  const { toast, toastError } = useToast();
  const { select, warning } = useHaptics();

  const items = useCrewStore((s) => s.packingItems);
  const loadPacking = useCrewStore((s) => s.loadPacking);
  const createPackingItem = useCrewStore((s) => s.createPackingItem);
  const updatePackingItem = useCrewStore((s) => s.updatePackingItem);
  const deletePackingItem = useCrewStore((s) => s.deletePackingItem);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Local load state around crewStore's loadPacking: the store's crewLoading/error
  // aren't scoped per sub-resource (crewLoading never toggles for loadPacking, and
  // error is shared across every crew tab), so real isLoading/isError needs to be
  // tracked here rather than pulled from the store.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { hiddenIds, remove } = useUndoableRemove(
    (itemId) => deletePackingItem(crewId, itemId),
    "Couldn't remove item. Try again.",
  );
  const visibleItems = items.filter((it) => !hiddenIds.has(it.id));

  useEffect(() => {
    if (!crewId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    loadPacking(crewId)
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [crewId, loadPacking]);

  function reset() {
    setLabel('');
    setShowForm(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const l = label.trim();
    if (!l || createBusy) return;
    setCreateBusy(true);
    try {
      const item = await createPackingItem(crewId, { label: l });
      const queued = isPending(item);
      toast(writeOutcomeMessage(queued ? 'queued' : 'sent', 'Item added'), queued ? 'info' : 'success');
      reset();
    } catch (err) {
      toastError(err, "Couldn't add item. Try again.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function toggleClaim(itemId: string, claimed: boolean) {
    select();
    setBusyId(itemId);
    try {
      // Claim: mark claimed + record this user as the bringer. Un-claim: clear both.
      await updatePackingItem(crewId, itemId, {
        claimed: !claimed,
        broughtBy: !claimed ? currentUserId : null,
      });
    } catch (err) {
      warning();
      toastError(err, "Couldn't update item. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3 px-4">
      {!showForm ? (
        <Button variant="primary" onClick={() => setShowForm(true)} className="w-full min-h-11">
          <Plus className="w-4 h-4" aria-hidden="true" /> Add packing item
        </Button>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">New item</h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>
          <Input
            label="Item"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Tent, cooler, sunscreen…"
            maxLength={200}
            required
          />
          <Button
            type="submit"
            variant="primary"
            isLoading={createBusy}
            className="w-full min-h-11"
            disabled={!label.trim()}
          >
            Add
          </Button>
        </form>
      )}

      {loading ? (
        <div className="space-y-2">
          <Skeleton variant="card" />
          <Skeleton variant="card" />
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<Backpack className="w-12 h-12" aria-hidden="true" />}
          title="Couldn't load packing list"
          description="Something went wrong loading the packing list."
          cta={{
            label: 'Retry',
            onClick: () => {
              setLoading(true);
              setLoadError(false);
              loadPacking(crewId)
                .catch(() => setLoadError(true))
                .finally(() => setLoading(false));
            },
          }}
        />
      ) : visibleItems.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="Nothing on the list yet"
          description="Add what your crew needs to bring, like a tent, a cooler or sunscreen."
          cta={{ label: 'Add item', onClick: () => setShowForm(true) }}
        />
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((item) => {
            const mine = item.brought_by === currentUserId;
            // A queued create has no server id yet, so it cannot be removed.
            const canRemove = !isPending(item) && (item.created_by === currentUserId || isOwner);
            return (
              <li key={item.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-bg-card border border-border">
                <button
                  type="button"
                  onClick={() => toggleClaim(item.id, item.claimed)}
                  disabled={busyId === item.id}
                  aria-pressed={item.claimed}
                  aria-label={item.claimed ? `Unclaim ${item.label}` : `Claim ${item.label}`}
                  className={`flex-shrink-0 w-6 h-6 min-h-11 min-w-11 rounded-md border flex items-center justify-center transition-colors ${
                    item.claimed
                      ? 'bg-accent-aqua/20 border-accent-aqua/40 text-accent-aqua'
                      : 'bg-bg-input border-border text-transparent'
                  }`}
                >
                  <Check className="w-4 h-4" aria-hidden="true" />
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm truncate ${
                      item.claimed ? 'text-text-secondary line-through' : 'text-text-primary'
                    }`}
                  >
                    {item.label}
                  </p>
                  {item.claimed && item.brought_by ? (
                    <p className="text-xs text-accent-aqua">{mine ? 'Bringing it' : 'Claimed'}</p>
                  ) : null}
                  <SyncMarker item={item} />
                </div>
                {canRemove ? (
                  <IconButton
                    label={`Remove ${item.label}`}
                    variant="danger"
                    icon={<Trash2 className="w-4 h-4" />}
                    onClick={() => remove(item.id, `"${item.label}"`)}
                    disabled={busyId === item.id}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
