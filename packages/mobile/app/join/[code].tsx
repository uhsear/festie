import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, AccessibilityInfo } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore, useCrewStore, useFestivalStore, useUIStore } from '@festie/shared/stores';
import { useJoinCrewByInvite } from '@festie/shared/hooks';
import type { InviteStatus } from '@festie/shared/utils';
import type { InvitePreview } from '@festie/shared/types';
import Button from '../../components/Button';
import BrandMark from '../../components/BrandMark';
import InviteCard from '../../components/InviteCard';
import DisplayWords from '../../components/DisplayWords';
import { isValidInviteCode, setPendingInvite } from '../../lib/pendingInvite';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg.primary },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: t.spacing[6] },
  title: {
    ...typeStyle('heading'),
    color: t.colors.text.primary,
    textAlign: 'center',
    marginBottom: t.spacing[4],
  },
  body: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
    marginBottom: t.spacing[6],
  },
  error: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
    textAlign: 'center',
    marginBottom: t.spacing[4],
  },
  secondary: { marginTop: t.spacing[3] },
}));

/**
 * Invite landing screen for `/join/<code>`. A guest sees who invited them and is
 * sent to sign up or sign in; a signed-in user confirms before joining, so a bare
 * link never enrolls anyone.
 */
export default function JoinInviteScreen() {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code?: string }>();
  const user = useAuthStore((s) => s.user);
  const joinByInvite = useJoinCrewByInvite();
  const currentFestivalId = useFestivalStore((s) => s.currentFestival?.id);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const error = useCrewStore((s) => s.error);
  const setError = useCrewStore((s) => s.setError);

  const validCode = isValidInviteCode(code) ? code : null;
  const [inviteStatus, setInviteStatus] = useState<InviteStatus>('loading');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const handleStatus = useCallback((status: InviteStatus, p: InvitePreview | null) => {
    setInviteStatus(status);
    setPreview(p);
  }, []);
  // Loading and unreachable still allow Join; only a confirmed-dead invite hides the actions.
  const inviteDead = inviteStatus === 'invalid' || inviteStatus === 'expired';
  const inviteUsable = !!validCode && !inviteDead;
  const full = preview?.spotsLeft === 0;
  const switchesFestival = !!preview?.festivalId && !!preview.festivalName && preview.festivalId !== currentFestivalId;

  // Keep the code so sign-in and sign-up can show the invite and return here.
  useEffect(() => {
    setPendingInvite(validCode);
  }, [validCode]);

  const handleJoin = async () => {
    if (!validCode) return;
    setError(null);
    try {
      const outcome = await joinByInvite(validCode);
      setPendingInvite(null);
      if (outcome.kind === 'already') {
        AccessibilityInfo.announceForAccessibility(`You're already in ${outcome.crew.name}`);
      } else if (outcome.kind === 'queued') {
        // A toast, not screen text: the global Toaster outlives the replace below.
        useUIStore.getState().showToast("We'll join you when you're back online.", { kind: 'info' });
      }
      router.replace('/(tabs)/crew');
    } catch {
      // Error is set in the store.
    }
  };

  const leave = () => {
    setPendingInvite(null);
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={[
          styles.inner,
          { paddingTop: insets.top + t.spacing[6], paddingBottom: insets.bottom + t.spacing[6] },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <BrandMark />
        <Text style={styles.title} accessibilityRole="header">
          <DisplayWords text="Crew invite" fontSize={styles.title.fontSize} />
        </Text>

        <InviteCard code={validCode} onStatus={handleStatus} />
        {!validCode ? (
          <Text style={styles.error} accessibilityRole="alert">
            This invite link is not valid. Ask the crew owner to share it again.
          </Text>
        ) : null}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}

        {inviteUsable && user ? (
          <>
            <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              Crew members can see your picks and your status.
            </Text>
            {switchesFestival ? (
              <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                Joining switches you to {preview?.festivalName}.
              </Text>
            ) : null}
            <Button
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              label={full ? 'Crew is full' : 'Join crew'}
              onPress={handleJoin}
              loading={crewLoading}
              disabled={full}
            />
          </>
        ) : null}

        {inviteDead && user ? (
          <Button
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            label="Type an invite code"
            onPress={() => {
              setPendingInvite(null);
              router.replace('/(tabs)/crew');
            }}
          />
        ) : null}

        {inviteUsable && !user ? (
          <>
            <Button
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              label="Create account to join"
              onPress={() => router.push('/(auth)/register')}
            />
            <Button
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              label="Sign in"
              variant="secondary"
              onPress={() => router.push('/(auth)/login')}
              style={styles.secondary}
            />
          </>
        ) : null}

        {inviteDead && !user ? (
          <Button
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            label="Create account"
            onPress={() => {
              setPendingInvite(null);
              router.push('/(auth)/register');
            }}
          />
        ) : null}

        <Button
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          label="Not now"
          variant="ghost"
          onPress={leave}
          style={styles.secondary}
        />
      </ScrollView>
    </View>
  );
}
