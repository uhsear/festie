import { useId, type Dispatch, RefObject, SetStateAction, FormEvent } from 'react';
import { COPY, MEETING_POINT_KINDS } from '@festie/shared/constants';
import { MEETING_POINT_PAST_HINT, type resolveFestivalTimeZone } from '@festie/shared';
import { Check, LocateFixed, Repeat, X } from 'lucide-react';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import { inputBase } from '../../lib/styles';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

interface MeetingPointFormProps {
  formRef: RefObject<HTMLFormElement | null>;
  labelInputRef: RefObject<HTMLInputElement | null>;
  editing: boolean;
  type: string;
  label: string;
  location: string;
  stageRef: string;
  meetAt: string;
  /** Why the time cannot be saved; blocks Add and Save. */
  meetAtError?: string;
  recursDaily: boolean;
  coords: { lat: number; lng: number } | null;
  festivalTimeZone: ReturnType<typeof resolveFestivalTimeZone>;
  locating: boolean;
  submitting: boolean;
  onTypeChange: (type: string) => void;
  onLabelChange: (label: string) => void;
  onLocationChange: (location: string) => void;
  onStageRefChange: (stageRef: string) => void;
  onMeetAtChange: (meetAt: string) => void;
  onRecursDailyChange: Dispatch<SetStateAction<boolean>>;
  onCoordsChange: (coords: { lat: number; lng: number } | null) => void;
  onSubmit: (e: FormEvent) => void;
  onReset: () => void;
  onCapture: () => void;
}

export default function MeetingPointForm({
  formRef,
  labelInputRef,
  editing,
  type,
  label,
  location,
  stageRef,
  meetAt,
  meetAtError,
  recursDaily,
  coords,
  festivalTimeZone,
  locating,
  submitting,
  onTypeChange,
  onLabelChange,
  onLocationChange,
  onStageRefChange,
  onMeetAtChange,
  onRecursDailyChange,
  onCoordsChange,
  onSubmit,
  onReset,
  onCapture,
}: MeetingPointFormProps) {
  const festivalTimeId = useId();
  return (
  <form ref={formRef} onSubmit={onSubmit} className="p-3 rounded-lg bg-bg-card border border-border space-y-3">
    <div className="flex items-center justify-between">
      <h3 className="font-semibold text-text-primary">
        {editing ? COPY.meetingPoint.edit : COPY.meetingPoint.add}
      </h3>
      <IconButton label="Cancel" icon={<X className="w-5 h-5" />} onClick={onReset} />
    </div>

    <div className="crew-type-grid grid grid-cols-2 gap-2" role="radiogroup" aria-label="Meeting point type">
      {MEETING_POINT_KINDS.map((k) => {
        const KindIcon = CONCEPT_ICON[k.icon];
        return (
          <button
            key={k.type}
            type="button"
            role="radio"
            aria-checked={type === k.type}
            onClick={() => onTypeChange(k.type)}
            className={`px-2 py-2 rounded-lg border text-xs font-medium min-h-11 flex flex-col items-center gap-1 transition-colors ${
              type === k.type
                ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
                : 'bg-bg-card border-border text-text-secondary hover:border-border-light'
            }`}
          >
            <KindIcon className="w-4 h-4" aria-hidden="true" />
            <span>{k.label}</span>
          </button>
        );
      })}
    </div>

    <input
      className={`${inputBase} min-h-11`}
      placeholder="Label (e.g. 'Main entrance')"
      aria-label="Label"
      ref={labelInputRef}
      value={label}
      onChange={(e) => onLabelChange(e.target.value)}
      maxLength={100}
      required
    />
    <input
      className={`${inputBase} min-h-11`}
      placeholder="Location (e.g. 'Near the food court')"
      aria-label="Location"
      value={location}
      onChange={(e) => onLocationChange(e.target.value)}
      maxLength={200}
      required
    />
    <input
      className={`${inputBase} min-h-11`}
      placeholder="Near stage (optional, e.g. 'Main Stage')"
      aria-label="Near stage"
      value={stageRef}
      onChange={(e) => onStageRefChange(e.target.value)}
      maxLength={100}
    />
    <label className="block text-xs text-text-muted">
      Meet at (optional)
      <input
        type="datetime-local"
        className={`${inputBase} min-h-11 mt-1`}
        aria-describedby={festivalTimeZone ? festivalTimeId : undefined}
        value={meetAt}
        onChange={(e) => onMeetAtChange(e.target.value)}
      />
    </label>
    {festivalTimeZone && (
      <p id={festivalTimeId} className="text-xs text-text-muted -mt-1">
        Festival time
      </p>
    )}
    {meetAtError ? (
      <p role="alert" className="text-xs text-[var(--color-text-danger)]">
        {meetAtError}
      </p>
    ) : (
      meetAt && !recursDaily && <p className="text-xs text-text-muted">{MEETING_POINT_PAST_HINT}</p>
    )}

    {/* 055: daily-recurrence toggle — only meaningful for a timed point.
        Aqua = selected (accent discipline); 44px target. */}
    {meetAt && (
      <button
        type="button"
        role="switch"
        aria-checked={recursDaily}
        onClick={() => onRecursDailyChange((v) => !v)}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium min-h-11 transition-colors ${
          recursDaily
            ? 'bg-accent-aqua/15 border-accent-aqua text-accent-aqua'
            : 'bg-bg-card border-border text-text-secondary hover:border-border-light'
        }`}
      >
        <Repeat className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 text-left">Repeats daily</span>
        {recursDaily && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
      </button>
    )}

    {/* F4: optional GPS capture. Falls back to free-text on denial. */}
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="secondary"
        onClick={onCapture}
        isLoading={locating}
        className="min-h-11"
      >
        <LocateFixed className="w-4 h-4" aria-hidden="true" /> Use my location
      </Button>
      {coords && (
        <span
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-accent-aqua/15 text-accent-aqua text-xs font-medium"
          title={`${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`}
        >
          <Check className="w-3 h-3" aria-hidden="true" />
          {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
          <button
            type="button"
            aria-label="Clear captured location"
            onClick={() => onCoordsChange(null)}
            className="ml-0.5 hover:text-accent-coral"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      )}
    </div>

    <Button
      type="submit"
      variant="primary"
      isLoading={submitting}
      className="w-full min-h-11"
      disabled={!label.trim() || !location.trim() || !!meetAtError}
    >
      {editing ? 'Save' : 'Add'}
    </Button>
  </form>
  );
}
