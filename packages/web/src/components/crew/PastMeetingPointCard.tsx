import type { CrewMeetingPoint } from '@festie/shared/types';
import { meetingPointKind } from '@festie/shared/constants';
import { Navigation } from 'lucide-react';
import { CONCEPT_ICON } from '../../lib/conceptIcons';
import IconButton from '../ui/IconButton';

interface PastMeetingPointCardProps {
  point: CrewMeetingPoint;
  onDirections: (point: CrewMeetingPoint) => void;
}

export default function PastMeetingPointCard({ point: p, onDirections }: PastMeetingPointCardProps) {
  const meta = meetingPointKind(p.type);
  const KindIcon = CONCEPT_ICON[meta.icon];
  return (
  <div className="p-3 rounded-xl bg-bg-card border border-border opacity-60">
    <div className="flex items-start gap-3">
      <KindIcon className="w-5 h-5 shrink-0 mt-0.5 text-text-secondary" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-primary">{p.label}</span>
          <span className="text-xs text-text-muted uppercase tracking-wide">{meta.label}</span>
        </div>
        <div className="text-sm text-text-secondary mt-0.5">{p.location}</div>
      </div>
      <IconButton
        label={`Directions to ${p.label}`}
        icon={<Navigation className="w-4 h-4" />}
        onClick={() => onDirections(p)}
      />
    </div>
  </div>
  );
}
