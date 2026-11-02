import React, { useEffect, useState } from 'react';
import { fetchCrewRatings, fetchCrowdRatings } from '@festie/shared/services';
import type { CrewRating, CrowdRating } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores/authStore';
import { useCrewStore } from '@festie/shared/stores/crewStore';
import { summarizeSetRatings } from '@festie/shared/utils';

interface Props {
  setId: string;
  festivalId: string;
}

export default function SetRatingSummary({ setId, festivalId }: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewId = activeCrew?.festivalId === festivalId ? activeCrew.id : null;
  const [crowd, setCrowd] = useState<Map<string, CrowdRating> | null>(null);
  const [crew, setCrew] = useState<Map<string, CrewRating[]> | null>(null);

  useEffect(() => {
    if (!festivalId) return;
    let active = true;
    // Async wrappers so a synchronous throw still lands in allSettled.
    const crowdCall = async () => fetchCrowdRatings(festivalId);
    const crewCall = async () => (crewId ? fetchCrewRatings(crewId, festivalId) : null);
    void Promise.allSettled([crowdCall(), crewCall()]).then(([crowdRes, crewRes]) => {
      if (!active) return;
      if (crowdRes.status === 'fulfilled') setCrowd(crowdRes.value);
      else console.warn('rating summary failed', crowdRes.reason);
      if (crewRes.status === 'fulfilled') setCrew(crewRes.value);
      else console.warn('rating summary failed', crewRes.reason);
    });
    return () => {
      active = false;
    };
  }, [festivalId, crewId]);

  const lines = summarizeSetRatings({ setId, crowd, crew, myUserId: userId });
  if (!lines.crowd && !lines.crew) return null;

  return (
    <div aria-live="polite" className="mt-1 text-center">
      {lines.crowd && <p className="type-meta text-text-muted">{lines.crowd}</p>}
      {lines.crew && <p className="type-meta text-text-muted">{lines.crew}</p>}
    </div>
  );
}
