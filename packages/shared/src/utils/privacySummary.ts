import { PRIVACY_COPY } from '../constants/privacyCopy';

export type PrivacyRowKey =
  | 'publicPage'
  | 'picksLinks'
  | 'paymentHandles'
  | 'liveLocation'
  | 'statusLocation'
  | 'profile';

export interface PrivacyRow {
  key: PrivacyRowKey;
  label: string;
  value: string;
  active: boolean;
}

export function buildPrivacySummary(input: {
  user: {
    publicSchedule?: boolean;
    venmoHandle?: string | null;
    cashappCashtag?: string | null;
    paypalHandle?: string | null;
  } | null;
  shareIntent: { crewId: string; expiresAt: string; paused: boolean } | null;
  myStatus: { latitude?: number | null; location_captured_at?: string | null } | null;
  crewNameById: (id: string) => string | null;
  activeCrewName: string | null;
  formatClock: (iso: string) => string;
}): { rows: PrivacyRow[]; canStop: boolean } {
  const { user, shareIntent, myStatus, crewNameById, activeCrewName, formatClock } = input;
  const C = PRIVACY_COPY;

  const publicOn = user?.publicSchedule === true;
  const handles = [
    user?.venmoHandle ? 'Venmo' : null,
    user?.cashappCashtag ? 'Cash App' : null,
    user?.paypalHandle ? 'PayPal' : null,
  ].filter((h): h is string => h !== null);

  const liveOn = shareIntent !== null;
  let liveValue: string = C.liveLocation.off;
  if (shareIntent) {
    const crew = crewNameById(shareIntent.crewId) ?? 'your crew';
    const clock = formatClock(shareIntent.expiresAt);
    liveValue = shareIntent.paused ? C.liveLocation.paused(crew, clock) : C.liveLocation.on(crew, clock);
  }

  const statusOn = myStatus?.latitude != null;
  let statusValue: string = C.statusLocation.off;
  if (myStatus && statusOn) {
    const crew = activeCrewName ?? 'Your crew';
    statusValue = myStatus.location_captured_at
      ? C.statusLocation.on(crew, formatClock(myStatus.location_captured_at))
      : `${crew} sees where you were recently.`;
  }

  const rows: PrivacyRow[] = [
    {
      key: 'publicPage',
      label: C.publicPage.label,
      value: publicOn ? C.publicPage.on : C.publicPage.off,
      active: publicOn,
    },
    { key: 'picksLinks', label: C.picksLinks.label, value: C.picksLinks.value, active: false },
    {
      key: 'paymentHandles',
      label: C.paymentHandles.label,
      value: handles.length ? C.paymentHandles.some(handles.join(' · ')) : C.paymentHandles.none,
      active: handles.length > 0,
    },
    { key: 'liveLocation', label: C.liveLocation.label, value: liveValue, active: liveOn },
    { key: 'statusLocation', label: C.statusLocation.label, value: statusValue, active: statusOn },
    { key: 'profile', label: C.profile.label, value: C.profile.value, active: false },
  ];
  return { rows, canStop: publicOn || liveOn || statusOn };
}
