import { crewFestivalName } from '@festie/shared/utils';
import { useFestivalStore } from '@festie/shared/stores';
import type { Crew, CrewMember } from '@festie/shared/types';
import Avatar from '../ui/Avatar';

const MAX_FACES = 5;

interface CrewHeaderProps {
  crew: Crew;
  members: CrewMember[];
  onOpenMembers: () => void;
}

export default function CrewHeader({ crew, members, onOpenMembers }: CrewHeaderProps) {
  const festivals = useFestivalStore((s) => s.festivals);
  const currentFestival = useFestivalStore((s) => s.currentFestival);
  const festival = crewFestivalName(crew, festivals, currentFestival);
  const count = members.length;
  const extra = count - MAX_FACES;

  return (
    <header className="flex items-center justify-between gap-3 min-w-0">
      <div className="min-w-0">
        <h1 className="text-xl font-display font-bold text-text-primary truncate">{crew.name}</h1>
        <p className="text-sm text-text-secondary">
          {festival ? `${festival} · ` : ''}
          {count} {count === 1 ? 'member' : 'members'}
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenMembers}
        aria-label={`See all ${count} members`}
        className="flex items-center min-h-11 shrink-0 rounded-full"
      >
        <span className="flex -space-x-2">
          {members.slice(0, MAX_FACES).map((m) => (
            <span key={m.userId} className="rounded-full ring-2 ring-surface">
              <Avatar name={m.name || m.username || 'User'} size="sm" />
            </span>
          ))}
        </span>
        {extra > 0 && <span className="ml-1 text-xs font-semibold text-text-secondary">+{extra}</span>}
      </button>
    </header>
  );
}
