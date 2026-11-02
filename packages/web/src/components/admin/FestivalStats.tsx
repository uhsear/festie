import React from 'react';

interface FestivalStat {
  id: string;
  name: string;
  profileCount: number;
  uniqueSetsPicked: number;
  totalPicks: number;
}

export interface FestivalStatsProps {
  stats: FestivalStat[];
  onSelect: (id: string) => void;
}

export default function FestivalStats({ stats, onSelect }: FestivalStatsProps) {
  if (stats.length === 0) return null;

  return (
    <div>
      <h2 className="type-heading text-text-primary mb-4">Festivals</h2>
      <div
        role="region"
        tabIndex={0} // eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- intentional: keeps this overflow-x-auto table keyboard-scrollable; rule only exempts role=tabpanel
        aria-label="Festival stats table"
        className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg overflow-x-auto focus:outline-none focus:ring-2 focus:ring-accent-aqua"
      >
        <table className="w-full text-sm">
          <caption className="sr-only">Festival statistics</caption>
          <thead>
            <tr className="text-left text-text-muted border-b border-glass-border">
              <th className="px-4 py-2">Festival</th>
              <th className="px-4 py-2 text-right">Festival plans</th>
              <th className="px-4 py-2 text-right">Unique Sets Picked</th>
              <th className="px-4 py-2 text-right">Total Picks</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((f) => (
              <tr key={f.id} className="border-b border-glass-border last:border-0">
                <td className="px-4 py-2 text-text-primary">
                  <button
                    type="button"
                    onClick={() => onSelect(f.id)}
                    className="min-h-11 text-left underline decoration-dotted hover:text-accent-aqua"
                  >
                    {f.name}
                  </button>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{f.profileCount}</td>
                <td className="px-4 py-2 text-right tabular-nums">{f.uniqueSetsPicked}</td>
                <td className="px-4 py-2 text-right tabular-nums">{f.totalPicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
