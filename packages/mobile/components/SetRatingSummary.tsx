import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { fetchCrowdRatings, fetchCrewRatings, type CrowdRating, type CrewRating } from '@festie/shared/services';
import { useAuthStore, useCrewStore } from '@festie/shared/stores';
import { summarizeSetRatings } from '@festie/shared/utils';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';

interface SetRatingSummaryProps {
  setId: string;
  festivalId: string;
}

/** Crowd and crew rating lines for one set. A failed fetch hides only its own line. */
export default function SetRatingSummary({ setId, festivalId }: SetRatingSummaryProps) {
  const styles = useStyles();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const activeCrew = useCrewStore((s) => s.activeCrew);
  const crewId = activeCrew?.festivalId === festivalId ? activeCrew.id : null;
  const [crowd, setCrowd] = useState<Map<string, CrowdRating> | null>(null);
  const [crew, setCrew] = useState<Map<string, CrewRating[]> | null>(null);

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    (async () => {
      const [crowdRes, crewRes] = await Promise.allSettled([
        fetchCrowdRatings(festivalId),
        crewId ? fetchCrewRatings(crewId, festivalId) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (crowdRes.status === 'fulfilled') setCrowd(crowdRes.value);
      else console.warn('rating summary failed', crowdRes.reason);
      if (crewRes.status === 'fulfilled') setCrew(crewRes.value);
      else console.warn('rating summary failed', crewRes.reason);
    })();
    return () => {
      cancelled = true;
    };
  }, [festivalId, crewId]);

  const lines = summarizeSetRatings({ setId, crowd, crew: crewId ? crew : null, myUserId: userId });
  return (
    <View accessibilityLiveRegion="polite">
      {[lines.crowd, lines.crew].map((line) =>
        line ? (
          <Text key={line} style={styles.line} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {line}
          </Text>
        ) : null,
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  line: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    marginTop: t.spacing[1],
    textAlign: 'center',
  },
}));
