import { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore, useCrewStore } from '@festie/shared/stores';
import Button from '../../components/Button';
import BrandMark from '../../components/BrandMark';
import InviteCard from '../../components/InviteCard';
import DisplayWords from '../../components/DisplayWords';
import { isValidInviteCode, setPendingInvite } from '../../lib/pendingInvite';
import { makeStyles, typeStyle, useTokens } from '../../hooks/useTokens';

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
  const joinByCode = useCrewStore((s) => s.joinByCode);
  const crewLoading = useCrewStore((s) => s.crewLoading);
  const error = useCrewStore((s) => s.error);
  const setError = useCrewStore((s) => s.setError);

  const validCode = isValidInviteCode(code) ? code : null;
  const [inviteStatus, setInviteStatus] = useState<'loading' | 'ready' | 'invalid'>('loading');
  // Loading still allows Join; only a confirmed-invalid invite hides the actions.
  const inviteUsable = !!validCode && inviteStatus !== 'invalid';

  // Keep the code so sign-in and sign-up can show the invite and return here.
  useEffect(() => {
    setPendingInvite(validCode);
  }, [validCode]);

  const handleJoin = async () => {
    if (!validCode) return;
    setError(null);
    try {
      await joinByCode({ inviteCode: validCode });
      setPendingInvite(null);
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

        <InviteCard code={validCode} onStatus={setInviteStatus} />
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
            <Text style={styles.body}>Crew members can see your picks and your status.</Text>
            <Button label="Join crew" onPress={handleJoin} loading={crewLoading} />
          </>
        ) : null}

        {inviteStatus === 'invalid' && user ? (
          <Button
            label="Enter a code in Crew"
            onPress={() => {
              setPendingInvite(null);
              router.replace('/(tabs)/crew');
            }}
          />
        ) : null}

        {inviteUsable && !user ? (
          <>
            <Button label="Create account to join" onPress={() => router.push('/(auth)/register')} />
            <Button
              label="Sign in"
              variant="secondary"
              onPress={() => router.push('/(auth)/login')}
              style={styles.secondary}
            />
          </>
        ) : null}

        <Button label="Not now" variant="ghost" onPress={leave} style={styles.secondary} />
      </ScrollView>
    </View>
  );
}
