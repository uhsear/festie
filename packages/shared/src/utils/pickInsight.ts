import { csvCell } from './auditActions';
import { formatTime } from './format';

export interface PickInsightSet {
  setId: string;
  dayIndex: number;
  dayLabel: string;
  date: string;
  stageName: string;
  artist: string;
  startTime: string | null;
  endTime: string | null;
  picks: number;
  must: number;
  want: number;
  maybe: number;
}

export interface PickInsightClash {
  aSetId: string;
  bSetId: string;
  people: number;
}

export interface PickInsight {
  festivalId: string;
  festivalName: string;
  minPairPeople: number;
  sets: PickInsightSet[];
  clashes: PickInsightClash[];
  generatedAt: string;
}

export interface PickClashRow {
  key: string;
  people: number;
  peopleText: string;
  barPct: number;
  title: string;
  detail: string;
  a11y: string;
}

const range = (s: PickInsightSet) =>
  `${formatTime(s.startTime ?? undefined)}–${formatTime(s.endTime ?? undefined)}`;

const stageAndRange = (s: PickInsightSet) => (s.stageName ? `${s.stageName} ${range(s)}` : range(s));

export function pickClashRows(insight: PickInsight): PickClashRow[] {
  const byId = new Map(insight.sets.map((s) => [s.setId, s]));
  const pairs = insight.clashes.flatMap((c) => {
    const a = byId.get(c.aSetId);
    const b = byId.get(c.bSetId);
    return a && b ? [{ c, a, b }] : [];
  });
  const maxPeople = Math.max(1, ...pairs.map((p) => p.c.people));
  return pairs.map(({ c, a, b }) => ({
    key: `${c.aSetId}|${c.bSetId}`,
    people: c.people,
    peopleText: `${c.people} people picked both`,
    barPct: Math.round((c.people / maxPeople) * 100),
    title: `${a.artist} and ${b.artist}`,
    detail: `${a.dayLabel} · ${stageAndRange(a)} · ${stageAndRange(b)}`,
    a11y: `${c.people} people picked both ${a.artist} and ${b.artist}, ${a.dayLabel}`,
  }));
}

const CSV_HEADER = ['Day', 'Date', 'Stage', 'Start', 'End', 'Artist', 'Picks', 'Must', 'Want', 'Maybe', 'Set ID'];

export function picksPerSetCsv(insight: PickInsight): string {
  const rows = insight.sets.map((s) =>
    [
      s.dayLabel,
      s.date,
      s.stageName,
      s.startTime ?? '',
      s.endTime ?? '',
      s.artist,
      String(s.picks),
      String(s.must),
      String(s.want),
      String(s.maybe),
      s.setId,
    ].map(csvCell),
  );
  return [CSV_HEADER, ...rows].map((r) => r.join(',')).join('\r\n');
}

export function picksCsvFileName(festivalId: string, now: Date = new Date()): string {
  return `festie-picks-${festivalId}-${now.toISOString().slice(0, 10)}.csv`;
}
