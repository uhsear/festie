import { useMemo } from 'react';
import type { FestivalDay, FestivalSet } from '@festie/shared/types';
import { buildListenList, listenListText } from '@festie/shared/utils';
import Button from '../ui/Button';
import { useToast } from '../../lib/toastContext';

interface Props {
  /** The sets to list, for example every set the viewer picked. */
  sets: FestivalSet[];
  days: FestivalDay[];
  festivalName: string;
  separator?: string;
}

/** "Listen before you go": picks by day with Spotify artist links and Copy as text. Link-outs only, no Spotify sign-in. */
export default function ListenList({ sets, days, festivalName, separator }: Props) {
  const { toast } = useToast();
  const list = useMemo(() => buildListenList(sets, days, separator), [sets, days, separator]);
  if (list.length === 0) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(listenListText(festivalName, list));
      toast('List copied', 'success');
    } catch {
      toast("Couldn't copy the list. Try again.", 'error');
    }
  };

  return (
    <details className="mb-4 rounded-xl border border-border bg-bg-card px-4">
      <summary className="min-h-11 flex items-center text-sm font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-accent-aqua">
        Listen before you go
      </summary>
      <div className="pb-3">
        {list.map((day) => (
          <div key={day.label} className="mb-3">
            <h4 className="text-xs uppercase tracking-[var(--letter-spacing-caps)] text-text-secondary font-semibold mb-1">
              {day.label}
            </h4>
            <ul>
              {day.rows.map((row) => (
                <li key={row.setId} className="flex items-center gap-2 min-h-11 text-sm">
                  <span className="flex-1 min-w-0 truncate">{row.name}</span>
                  {row.spotifyUrl && (
                    <a
                      href={row.spotifyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-aqua underline"
                      aria-label={`Open ${row.name} in Spotify`}
                    >
                      Spotify ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <Button variant="secondary" size="sm" type="button" onClick={handleCopy}>
          Copy as text
        </Button>
      </div>
    </details>
  );
}
