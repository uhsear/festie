import React from 'react';

export interface PickDistributionProps {
  must: number;
  want: number;
  maybe: number;
  /** Server-side total pick count, used in the heading. */
  total: number;
}

export default function PickDistribution({ must, want, maybe, total }: PickDistributionProps) {
  const sum = must + want + maybe;
  const mustPercent = sum > 0 ? (must / sum) * 100 : 0;
  const wantPercent = sum > 0 ? (want / sum) * 100 : 0;
  const maybePercent = sum > 0 ? (maybe / sum) * 100 : 0;

  return (
    <div>
      <h2 className="type-heading text-text-primary mb-4">Pick priority across all {total} picks</h2>
      <div className="bg-bg-card/60 backdrop-blur-xl border border-glass-border rounded-lg p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
          <div>
            <div className="text-sm text-text-muted mb-2">Must See</div>
            <div className="text-3xl font-bold text-accent-coral">{must}</div>
            <div className="text-xs text-text-muted mt-1">{mustPercent.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-sm text-text-muted mb-2">Want to See</div>
            <div className="text-3xl font-bold text-accent-aqua">{want}</div>
            <div className="text-xs text-text-muted mt-1">{wantPercent.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-sm text-text-muted mb-2">Maybe</div>
            <div className="text-3xl font-bold text-accent-amber">{maybe}</div>
            <div className="text-xs text-text-muted mt-1">{maybePercent.toFixed(1)}%</div>
          </div>
        </div>
        {/* Bar chart */}
        <div className="flex gap-1 h-8 rounded-lg overflow-hidden bg-bg-primary/20">
          {mustPercent > 0 && (
            <div
              style={{ flex: mustPercent }}
              className="bg-accent-coral transition-[flex-grow] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
              title={`Must: ${mustPercent.toFixed(1)}%`}
            />
          )}
          {wantPercent > 0 && (
            <div
              style={{ flex: wantPercent }}
              className="bg-accent-aqua transition-[flex-grow] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
              title={`Want: ${wantPercent.toFixed(1)}%`}
            />
          )}
          {maybePercent > 0 && (
            <div
              style={{ flex: maybePercent }}
              className="bg-accent-amber transition-[flex-grow] duration-[var(--duration-med)] ease-[var(--ease-out)] motion-reduce:transition-none"
              title={`Maybe: ${maybePercent.toFixed(1)}%`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
