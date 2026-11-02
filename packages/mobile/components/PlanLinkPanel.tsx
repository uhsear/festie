// Copyright (c) 2026 Asir Khan. All rights reserved.
// All Rights Reserved. See the LICENSE file.

import { useEffect, useState } from 'react';
import { Text, ScrollView, Share, Linking } from 'react-native';
import { router } from 'expo-router';
import { useFestivalDataStore, useAuthStore } from '@festie/shared/stores';
import { fetchShareLink } from '@festie/shared/services';
import { useTokens, makeStyles, typeStyle } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';
import Button from './Button';
import EmptyState from './EmptyState';

const NO_PROFILE = 'Pick a set at this festival first, then share your picks.';
const OFFLINE = 'Connect to the internet to get your link. Show QR works offline.';

type LinkState = { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error'; message: string };

/**
 * The Link tab of the share screen: a revocable public link to the user's picks
 * for the current festival, plus the status of the public schedule page.
 */
export default function PlanLinkPanel() {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset();
  const festival = useFestivalDataStore((s) => s.currentFestival);
  const publicSchedule = useAuthStore((s) => s.user?.publicSchedule === true);
  const festivalId = festival?.id;
  const [state, setState] = useState<LinkState>({ status: 'loading' });

  useEffect(() => {
    if (!festivalId) return;
    let cancelled = false;
    fetchShareLink(festivalId)
      .then(({ url }) => {
        if (!cancelled) setState({ status: 'ready', url });
      })
      .catch((e: unknown) => {
        const notFound = (e as { status?: number } | null)?.status === 404;
        if (!cancelled) setState({ status: 'error', message: notFound ? NO_PROFILE : OFFLINE });
      });
    return () => {
      cancelled = true;
    };
  }, [festivalId]);

  if (!festival) {
    return (
      <EmptyState
        icon="qr-code-outline"
        title="No plan to share yet"
        message="Open a festival and add a few picks, then come back to share them."
      />
    );
  }

  const goAccount = () => router.push('/(tabs)/account');

  return (
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
      <Text style={styles.heading}>Send a link</Text>
      <Text style={styles.body}>
        {`Anyone with this link can see your ${festival.name} picks. It stays up to date as you change them.`}
      </Text>

      {state.status === 'loading' ? <Text style={styles.muted}>Getting your link…</Text> : null}
      {state.status === 'error' ? <Text style={styles.muted}>{state.message}</Text> : null}
      {state.status === 'ready' ? (
        <>
          <Text style={styles.url} selectable>
            {state.url}
          </Text>
          <Button
            label="Share"
            icon="share-outline"
            onPress={() =>
              void Share.share({ message: `My ${festival.name} picks on Festie: ${state.url}`, url: state.url })
            }
          />
          <Button label="Open" icon="open-outline" variant="secondary" onPress={() => void Linking.openURL(state.url)} />
        </>
      ) : null}

      <Text style={[styles.muted, { color: t.colors.text.secondary }]}>
        {publicSchedule
          ? 'Public schedule page is on. It shows your newest festival.'
          : 'Public schedule page is off.'}
      </Text>
      <Button label="Change in Account" variant="ghost" onPress={goAccount} />
      <Text style={styles.muted}>Sent a link by mistake?</Text>
      <Button label="Reset your links in Account" variant="ghost" onPress={goAccount} />
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  content: {
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  heading: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  body: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  url: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  muted: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
}));
