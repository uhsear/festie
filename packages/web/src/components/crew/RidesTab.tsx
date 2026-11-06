import React, { useEffect, useState } from 'react';
import {
  useCrewStore,
  isPending,
  writeOutcomeMessage,
  rideSeatAction,
  rideSeatsLine,
  ridePassengersLine,
  rideDirectionLabel,
  rideDayOptions,
  rideDepartIso,
  rideTimeParts,
  rideTimeLabel,
} from '@festie/shared';
import { useFestivalStore } from '@festie/shared/stores';
import type { CrewRideOffer, FestivalDay } from '@festie/shared';
import { useToast } from '../../lib/toastContext';
import { useHaptics } from '../../hooks/useHaptics';
import Button from '../ui/Button';
import Input from '../ui/Input';
import EmptyState from '../ui/EmptyState';
import IconButton from '../ui/IconButton';
import SyncMarker from './SyncMarker';
import { useUndoableRemove } from './useUndoableRemove';
import { Car, MapPin, Pencil, Plus, Trash2, Users, X } from 'lucide-react';

interface Props {
  crewId: string;
  currentUserId: string;
  isOwner: boolean;
}

type Direction = 'to_festival' | 'home';

/**
 * Crew carpool / ride board (M2 logistics) — a shared "who's driving" board.
 * Offline-native: reads/writes go through the crewStore, so an offer posted with
 * no signal renders optimistically and reconciles when the queued POST replays
 * (same pattern as packing). Each row is a ride OFFER — driver, direction, a real
 * departure time in festival time, seats and who is riding. Members take and
 * leave seats; the poster or the owner can edit the ride.
 */
export default function RidesTab({ crewId, currentUserId, isOwner }: Props) {
  const { toast, toastError } = useToast();
  const { warning } = useHaptics();

  const offers = useCrewStore((s) => s.rideOffers);
  const loadRides = useCrewStore((s) => s.loadRides);
  const createRideOffer = useCrewStore((s) => s.createRideOffer);
  const updateRideOffer = useCrewStore((s) => s.updateRideOffer);
  const deleteRideOffer = useCrewStore((s) => s.deleteRideOffer);
  const takeRideSeat = useCrewStore((s) => s.takeRideSeat);
  const leaveRideSeat = useCrewStore((s) => s.leaveRideSeat);
  // Select separately: one selector returning `?? []` would make a new array each render.
  const crewMembers = useCrewStore((s) => s.crewMembers);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const members = crewMembers.length ? crewMembers : (activeCrew?.members ?? []);

  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festivalDays = useFestivalStore((s) => s.days) as FestivalDay[];
  const festival = currentFestival?.id === activeCrew?.festivalId ? currentFestival : null;
  const timeZone = festival?.timeZone;
  const dayOptions = festival ? rideDayOptions(festivalDays, timeZone) : [];
  const hasFrame = !!festival && dayOptions.length > 0;

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [driver, setDriver] = useState('');
  const [direction, setDirection] = useState<Direction>('to_festival');
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [seats, setSeats] = useState('');
  const [departFrom, setDepartFrom] = useState('');
  const [departAt, setDepartAt] = useState('');
  const [note, setNote] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [seatBusyId, setSeatBusyId] = useState<string | null>(null);
  const { hiddenIds, remove } = useUndoableRemove(
    (offerId) => deleteRideOffer(crewId, offerId),
    "Couldn't remove ride. Try again.",
  );
  const visibleOffers = offers.filter((o) => !hiddenIds.has(o.id));

  useEffect(() => {
    if (crewId) loadRides(crewId).catch(() => {});
  }, [crewId, loadRides]);

  const myName = members.find((m) => m.userId === currentUserId);
  const myDisplayName = myName?.name || myName?.username || '';

  function reset() {
    setDriver('');
    setDirection('to_festival');
    setDay('');
    setTime('');
    setSeats('');
    setDepartFrom('');
    setDepartAt('');
    setNote('');
    setEditingId(null);
    setShowForm(false);
  }

  function openCreate() {
    reset();
    setDriver(myDisplayName);
    setShowForm(true);
  }

  function openEdit(offer: CrewRideOffer) {
    const parts = offer.depart_time ? rideTimeParts(offer.depart_time, timeZone) : null;
    setEditingId(offer.id);
    setDriver(offer.driver ?? '');
    setDirection(offer.direction ?? 'to_festival');
    setDay(parts?.date ?? '');
    setTime(parts?.time ?? '');
    setSeats(typeof offer.seats === 'number' ? String(offer.seats) : '');
    setDepartFrom(offer.depart_from ?? '');
    setDepartAt(offer.depart_at ?? '');
    setNote(offer.note ?? '');
    setShowForm(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (createBusy) return;
    const d = driver.trim();
    const from = departFrom.trim();
    const at = departAt.trim();
    const n = note.trim();
    const seatsNum = seats.trim() ? Number(seats.trim()) : null;
    const departTime = hasFrame && day && time ? rideDepartIso(day, time, timeZone) : null;
    // Require at least one meaningful field so we don't post an empty offer.
    if (!d && !from && !at && !n && !departTime && seatsNum == null) return;
    const request = {
      driver: d || null,
      direction,
      seats: seatsNum != null && Number.isFinite(seatsNum) ? seatsNum : null,
      departFrom: from || null,
      note: n || null,
      // PUT is partial: leave out the time fields the form did not set, so an edit never wipes them.
      ...(hasFrame ? {} : { departAt: at || null }),
      ...(departTime ? { departTime } : {}),
    };
    setCreateBusy(true);
    try {
      if (editingId) {
        await updateRideOffer(crewId, editingId, request);
        toast('Ride saved', 'success');
      } else {
        const offer = await createRideOffer(crewId, request);
        const queued = isPending(offer);
        toast(writeOutcomeMessage(queued ? 'queued' : 'sent', 'Ride posted'), queued ? 'info' : 'success');
      }
      reset();
    } catch (err) {
      warning();
      toastError(err, editingId ? "Couldn't save ride. Try again." : "Couldn't post ride. Try again.");
    } finally {
      setCreateBusy(false);
    }
  }

  async function changeSeat(offerId: string, action: 'take' | 'leave') {
    setSeatBusyId(offerId);
    try {
      const outcome =
        action === 'take'
          ? await takeRideSeat(crewId, offerId, currentUserId)
          : await leaveRideSeat(crewId, offerId, currentUserId);
      if (outcome === 'queued') toast(writeOutcomeMessage('queued', 'Seat updated'), 'info');
    } catch (err) {
      warning();
      toastError(err, "Couldn't update your seat. Try again.");
    } finally {
      setSeatBusyId(null);
    }
  }

  const canSubmit =
    !!driver.trim() ||
    !!departFrom.trim() ||
    !!departAt.trim() ||
    !!note.trim() ||
    !!seats.trim() ||
    (hasFrame && !!day && !!time);

  return (
    <div className="space-y-3 px-4">
      {!showForm ? (
        <Button variant="primary" onClick={openCreate} className="w-full min-h-11">
          <Plus className="w-4 h-4" aria-hidden="true" /> Post a ride
        </Button>
      ) : (
        <form onSubmit={submit} className="p-3 rounded-lg bg-bg-card border border-glass-border space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-text-primary">{editingId ? 'Edit ride' : 'New ride'}</h3>
            <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={reset} />
          </div>
          <Input
            label="Driver"
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
            placeholder="Who's driving?"
            maxLength={100}
          />
          <div role="group" aria-label="Direction" className="flex gap-2">
            {(['to_festival', 'home'] as const).map((value) => (
              <Button
                key={value}
                type="button"
                variant={direction === value ? 'primary' : 'outline'}
                aria-pressed={direction === value}
                onClick={() => setDirection(value)}
                className="flex-1 min-h-11"
              >
                {rideDirectionLabel(value)}
              </Button>
            ))}
          </div>
          {hasFrame ? (
            <>
              <div role="group" aria-label="Day" className="flex flex-wrap gap-2">
                {dayOptions.map((o) => (
                  <Button
                    key={o.date}
                    type="button"
                    variant={day === o.date ? 'primary' : 'outline'}
                    aria-pressed={day === o.date}
                    onClick={() => setDay(o.date)}
                    className="min-h-11"
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
              <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </>
          ) : (
            <Input
              label="When"
              value={departAt}
              onChange={(e) => setDepartAt(e.target.value)}
              placeholder="Fri 2pm"
              maxLength={100}
            />
          )}
          <Input
            label="Seats"
            type="number"
            min={0}
            max={99}
            value={seats}
            onChange={(e) => setSeats(e.target.value)}
            placeholder="Open seats"
          />
          <Input
            label="Leaving from"
            value={departFrom}
            onChange={(e) => setDepartFrom(e.target.value)}
            placeholder="Pickup spot"
            maxLength={200}
          />
          <Input
            label="Note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything else?"
            maxLength={500}
          />
          <Button
            type="submit"
            variant="primary"
            isLoading={createBusy}
            className="w-full min-h-11"
            disabled={!canSubmit}
          >
            {editingId ? 'Save ride' : 'Post ride'}
          </Button>
        </form>
      )}

      {visibleOffers.length === 0 ? (
        <EmptyState
          illustration="emptyList"
          title="No rides yet"
          description="Offer a ride, or ask for one."
          cta={{ label: 'Offer a ride', onClick: openCreate }}
        />
      ) : (
        <ul className="space-y-2">
          {visibleOffers.map((offer) => {
            // A queued create has no server id yet, so it cannot be removed or edited.
            const queued = isPending(offer);
            const canManage = !queued && (offer.created_by === currentUserId || isOwner);
            const title = offer.driver || 'Ride offer';
            const seatAction = queued ? 'none' : rideSeatAction(offer, currentUserId);
            const directionLabel = rideDirectionLabel(offer.direction);
            const timeLabel = rideTimeLabel(offer, timeZone);
            const seatsLine = rideSeatsLine(offer);
            const passengersLine = ridePassengersLine(offer, members, currentUserId);
            return (
              <li key={offer.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-bg-card border border-border">
                <div className="flex-shrink-0 w-6 h-6 rounded-md bg-accent-aqua/15 border border-accent-aqua/30 text-accent-aqua flex items-center justify-center">
                  <Car className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary line-clamp-2 break-words">{title}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {directionLabel ? (
                      <span className="text-xs px-1.5 rounded bg-accent-aqua/15 text-accent-aqua">
                        {directionLabel}
                      </span>
                    ) : null}
                    {timeLabel ? <span className="text-xs text-text-secondary">{timeLabel}</span> : null}
                    {seatsLine ? (
                      <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
                        <Users className="w-3 h-3" aria-hidden="true" />
                        {seatsLine}
                      </span>
                    ) : null}
                    {offer.depart_from ? (
                      <span className="inline-flex items-center gap-1 text-xs text-text-secondary truncate">
                        <MapPin className="w-3 h-3" aria-hidden="true" />
                        {offer.depart_from}
                      </span>
                    ) : null}
                  </div>
                  {passengersLine ? <p className="text-xs text-text-secondary mt-0.5">{passengersLine}</p> : null}
                  {offer.note ? <p className="text-xs text-text-muted mt-0.5 break-words">{offer.note}</p> : null}
                  {seatAction === 'take' || seatAction === 'leave' ? (
                    <Button
                      variant="outline"
                      onClick={() => changeSeat(offer.id, seatAction)}
                      disabled={seatBusyId === offer.id}
                      className="mt-1.5 min-h-11"
                    >
                      {seatAction === 'take' ? 'Take a seat' : 'Leave ride'}
                    </Button>
                  ) : null}
                  {seatAction === 'full' ? (
                    <Button variant="outline" disabled className="mt-1.5 min-h-11">
                      Full
                    </Button>
                  ) : null}
                  <SyncMarker item={offer} />
                </div>
                {canManage ? (
                  <div className="flex">
                    <IconButton
                      label="Edit ride"
                      icon={<Pencil className="w-4 h-4" />}
                      onClick={() => openEdit(offer)}
                    />
                    <IconButton
                      label={`Remove ride: ${title}`}
                      variant="danger"
                      icon={<Trash2 className="w-4 h-4" />}
                      onClick={() => remove(offer.id, `ride "${title}"`)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
