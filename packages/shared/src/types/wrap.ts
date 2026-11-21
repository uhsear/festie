export interface WrapStats {
  totalRated: number;
  avgRating: number | null;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number;
}

export interface WrapRatedSet {
  setId: string;
  rating: number;
  note: string | null;
  artist: string | null;
  stageId: string | null;
  stageName: string | null;
  dayIndex: number | null;
  startTime: string | null;
  endTime: string | null;
}

export interface WrapPlannedSet {
  setId: string;
  artist: string | null;
  stageId: string | null;
  stageName: string | null;
  dayIndex: number | null;
  startTime: string | null;
  endTime: string | null;
  priority: 'must' | 'want-to-see' | 'maybe';
  rating: number | null;
  note: string | null;
  /** Other members of `crew` who picked this set; null when the requester has no crew. */
  crewAlso: number | null;
  /** Saw it (true), skipped (false), or not marked (null). */
  caught: boolean | null;
}

/** A set the user marked caught but did not pick (their own marks only). */
export interface WrapCaughtSet {
  setId: string;
  artist: string | null;
  stageId: string | null;
  stageName: string | null;
  dayIndex: number | null;
  startTime: string | null;
  endTime: string | null;
  rating: number | null;
  note: string | null;
  /** Always true from the server; the client sets null after Remove. */
  caught: boolean | null;
}

export interface WrapFestival {
  id: string;
  name: string;
  timeZone: string | null;
  days: Array<{ date: string; label: string | null }>;
}

export interface WrapCrew {
  id: string;
  name: string;
  memberCount: number;
  photoAlbumUrl: string | null;
}

export interface WrapResponse {
  stats: WrapStats;
  topSets: WrapRatedSet[];
  allRatings: WrapRatedSet[];
  festival: WrapFestival;
  planned: WrapPlannedSet[];
  /** Absent from servers that predate T53. */
  caughtExtra?: WrapCaughtSet[];
  crew: WrapCrew | null;
}

export interface WrapCard {
  kind: 'plan' | 'top' | 'clash' | 'crew' | 'memory' | 'summary';
  kicker: string;
  headline: string;
  sub?: string;
  rows?: Array<{ primary: string; secondary?: string | null; rating?: number | null; badge?: string }>;
  quote?: { text: string; by: string };
  stats?: Array<{ label: string; value: string }>;
}

/** Server shape from GET /ratings/lifetime (cross-festival history). */
export interface LifetimeTotals {
  totalRated: number;
  avgRating: number | null;
  festivalsAttended: number;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}

export interface LifetimeFestivalRow {
  festivalId: string;
  festivalName: string | null;
  startDate: string | null;
  endDate: string | null;
  totalRated: number;
  avgRating: number | null;
  stagesVisited: number;
  daysAttended: number;
  totalHours: number | null;
}

export interface LifetimeTopArtist {
  artist: string;
  timesRated: number;
  bestRating: number;
  avgRating: number | null;
}

export interface LifetimeResponse {
  totals: LifetimeTotals;
  byFestival: LifetimeFestivalRow[];
  topArtists: LifetimeTopArtist[];
  /** Absent on an older server. */
  seenMost?: { artist: string; festivals: number }[];
}
