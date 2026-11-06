import React, { useEffect, useState } from 'react';
import {
  useCrewStore,
  isPending,
  writeOutcomeMessage,
  packingClaim,
  packingClaimLine,
  memberDisplayName,
  PACKING_TEMPLATES,
} from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import IconButton from '../ui/IconButton';
import Avatar from '../ui/Avatar';
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
 * to the current user; only that member or the crew owner can release it. The
 * claimer can tick "Packed", and anyone can rename an item.
 */
export default function PackingTab({ crewId, currentUserId, isOwner }: Props) {
  const { toast, toastError } = useToast();
  const { select, warning } = useHaptics();

  const items = useCrewStore((s) => s.packingItems);
  const loadPacking = useCrewStore((s) => s.loadPacking);
  const createPackingItem = useCrewStore((s) => s.createPackingItem);
  const updatePackingItem = useCrewStore((s) => s.updatePackingItem);
  const deletePackingItem = useCrewStore((s) => s.deletePackingItem);
  const addPackingItems = useCrewStore((s) => s.addPackingItems);
  // Select separately: one selector returning `?? []` would make a new array each render.
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const members = crewMembers.length ? crewMembers : (activeCrew?.members ?? []);

  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
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

  async function patchItem(itemId: string, request: Parameters<typeof updatePackingItem>[2]) {
    select();
    setBusyId(itemId);
    try {
      await updatePackingItem(crewId, itemId, request);
      return true;
    } catch (err) {
      warning();
      toastError(err, "Couldn't update item. Try again.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(itemId: string, current: string) {
    setEditingId(itemId);
    setEditLabel(current);
  }

  async function saveEdit(itemId: string, current: string) {
    const next = editLabel.trim();
    if (!next) return;
    if (next === current) {
      setEditingId(null);
      return;
    }
    if (await patchItem(itemId, { label: next })) setEditingId(null);
  }

  async function addTemplate(labels: readonly string[]) {
    try {
      const outcome = await addPackingItems(crewId, [...labels]);
      toast(writeOutcomeMessage(outcome, `Added ${labels.length} items`), outcome === 'queued' ? 'info' : 'success');
    } catch (err) {
      toastError(err, "Couldn't add items. Try again.");
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
        <>
          <EmptyState
            illustration="emptyList"
            title="Nothing on the list yet"
            description="Add what your crew needs to bring, like a tent, a cooler or sunscreen."
            cta={{ label: 'Add item', onClick: () => setShowForm(true) }}
          />
          <div className="space-y-2 text-center">
            <p className="text-sm text-text-secondary">Start from a list:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {PACKING_TEMPLATES.map((t) => (
                <Button key={t.id} variant="outline" onClick={() => addTemplate(t.items)} className="min-h-11">
                  {t.label}
                </Button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <ul className="space-y-2">
          {visibleItems.map((item) => {
            const claim = packingClaim(item, currentUserId, isOwner);
            const busy = busyId === item.id;
            // A queued create has no server id yet, so it cannot be removed.
            const canRemove = !isPending(item) && (item.created_by === currentUserId || isOwner);
            const claimerId = claim.state === 'mine' ? currentUserId : claim.state === 'theirs' ? claim.userId : null;
            const packed = claim.state !== 'open' && claim.packed;
            return (
              <li key={item.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-bg-card border border-border">
                <div className="min-w-0 flex-1 space-y-1">
                  {editingId === item.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit(item.id, item.label);
                      }}
                      className="space-y-2"
                    >
                      <Input
                        aria-label="Item name"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        maxLength={200}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <div className="flex gap-2">
                        <Button type="submit" variant="primary" disabled={!editLabel.trim() || busy} className="min-h-11">
                          Save
                        </Button>
                        <Button type="button" variant="outline" onClick={() => setEditingId(null)} className="min-h-11">
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(item.id, item.label)}
                      aria-label={`Rename ${item.label}`}
                      className="flex items-center gap-1.5 max-w-full text-left text-sm text-text-primary min-h-11"
                    >
                      {packed ? <Check className="w-4 h-4 flex-shrink-0 text-accent-aqua" aria-hidden="true" /> : null}
                      <span className="line-clamp-2 break-words">{item.label}</span>
                    </button>
                  )}
                  {claimerId ? (
                    <div className="flex items-center gap-2">
                      <Avatar size="xs" name={memberDisplayName(members, claimerId)} />
                      <p className="text-xs text-accent-aqua">{packingClaimLine(item, members, currentUserId)}</p>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {claim.state === 'open' ? (
                      <Button
                        variant="outline"
                        onClick={() => patchItem(item.id, { claimed: true })}
                        disabled={busy}
                        className="min-h-11"
                      >
                        I'll bring it
                      </Button>
                    ) : null}
                    {claim.state === 'mine' ? (
                      <>
                        <Button
                          variant="outline"
                          aria-pressed={claim.packed}
                          onClick={() => patchItem(item.id, { packed: !claim.packed })}
                          disabled={busy}
                          className="min-h-11"
                        >
                          <Check className="w-4 h-4" aria-hidden="true" /> Packed
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => patchItem(item.id, { claimed: false })}
                          disabled={busy}
                          className="min-h-11"
                        >
                          Not bringing it
                        </Button>
                      </>
                    ) : null}
                    {claim.state === 'theirs' && claim.canRelease ? (
                      <Button
                        variant="ghost"
                        onClick={() => patchItem(item.id, { claimed: false })}
                        disabled={busy}
                        className="min-h-11"
                      >
                        Remove claim
                      </Button>
                    ) : null}
                  </div>
                  <SyncMarker item={item} />
                </div>
                {canRemove ? (
                  <IconButton
                    label={`Remove ${item.label}`}
                    variant="danger"
                    icon={<Trash2 className="w-4 h-4" />}
                    onClick={() => remove(item.id, `"${item.label}"`)}
                    disabled={busy}
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
