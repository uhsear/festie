import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Linking,
} from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '@festie/shared/stores';
import { AUTH_COPY } from '@festie/shared/constants';
import { isValidEmail } from '@festie/shared/utils';
import Button from '../../components/Button';
import BrandMark from '../../components/BrandMark';
import { makeStyles, typeScaleCap, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';

/**
 * Forgot-password screen — mobile mirror of the web /forgot-password page.
 * Collects an email and calls the shared authStore.forgotPassword, then shows
 * a "check your email" confirmation. The reset link itself is completed via the
 * emailed link (the app's reset-password screen, or the web SPA route); this screen only requests it.
 */

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  inner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: t.spacing[6],
  },
  title: {
    // display-lg = Clash Display 700 — brand wordmark, first impression screen.
    ...typeStyle('display-lg'),
    color: t.colors.accent.coral,
    textAlign: 'center',
    marginBottom: t.spacing[1],
  },
  subtitle: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    textAlign: 'center',
    marginBottom: t.spacing[2],
  },
  screenLine: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
    textAlign: 'center',
    marginBottom: t.spacing[8],
  },
  error: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
    textAlign: 'center',
    marginBottom: t.spacing[3],
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
    marginBottom: t.spacing[2],
  },
  helper: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
    marginBottom: t.spacing[4],
  },
  successBox: {
    alignItems: 'center' as const,
    gap: t.spacing[3],
    padding: t.spacing[5],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  successTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  successBody: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
    textAlign: 'center',
  },
  successHint: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
    textAlign: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    alignItems: 'center' as const,
    alignSelf: 'stretch' as const,
    marginTop: t.spacing[2],
  },
  secondaryButtonText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  linkButton: {
    marginTop: t.spacing[5],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: 44,
  },
  supportHint: {
    ...typeStyle('label'),
    color: t.colors.text.muted,
    textAlign: 'center',
    marginTop: t.spacing[5],
  },
  supportLink: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  linkTextAccent: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
}));

export default function ForgotPasswordScreen() {
  const styles = useStyles();
  const t = useTokens();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);

  // Drop an error left over from another auth screen (the store is shared).
  useFocusEffect(
    useCallback(() => {
      setError(null);
    }, [setError]),
  );

  const handleSubmit = async () => {
    Keyboard.dismiss();
    const trimmed = email.trim();
    if (!trimmed) {
      setEmailError('Email is required');
      return;
    }
    if (!isValidEmail(trimmed)) {
      setEmailError('Invalid email address');
      return;
    }
    setEmailError('');
    setError(null);
    try {
      await forgotPassword({ email: trimmed });
      setSubmitted(true);
    } catch {
      // Error is set in the store and surfaced below.
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[
          styles.inner,
          { paddingTop: insets.top + t.spacing[6], paddingBottom: insets.bottom + t.spacing[6] },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <BrandMark />
        <Text style={styles.title} maxFontSizeMultiplier={typeScaleCap('display-lg')}>{AUTH_COPY.wordmark}</Text>
        <Text style={styles.subtitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>{AUTH_COPY.tagline}</Text>
        <Text style={styles.screenLine} maxFontSizeMultiplier={MAX_FONT_SCALE}>{AUTH_COPY.resetTitle}</Text>

        {!submitted ? (
          <>
            {error ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                {error}
              </Text>
            ) : null}

            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={t.colors.text.placeholder}
              accessibilityLabel="Email address"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                if (emailError) setEmailError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />
            {emailError ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                {emailError}
              </Text>
            ) : null}
            <Text style={styles.helper}>We'll send you a link to reset your password.</Text>

            <Button
              label={AUTH_COPY.sendResetLink}
              onPress={handleSubmit}
              loading={isLoading}
              accessibilityState={{ disabled: isLoading, busy: isLoading }}
            />
          </>
        ) : (
          <View style={styles.successBox} accessibilityLiveRegion="polite">
            <Ionicons name="checkmark-circle" size={48} color={t.colors.accent.aqua} />
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successBody}>{AUTH_COPY.forgotSent(email.trim())}</Text>
            <Text style={styles.successHint}>{AUTH_COPY.forgotSentHint}</Text>
            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => {
                setSubmitted(false);
              }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={AUTH_COPY.useDifferentEmail}
            >
              <Text style={styles.secondaryButtonText}>{AUTH_COPY.useDifferentEmail}</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.supportHint}>
          {AUTH_COPY.noEmailHint.split(AUTH_COPY.supportEmail)[0]}
          <Text
            style={styles.supportLink}
            accessibilityRole="link"
            onPress={() => Linking.openURL(`mailto:${AUTH_COPY.supportEmail}`)}
          >
            {AUTH_COPY.supportEmail}
          </Text>
          {AUTH_COPY.noEmailHint.split(AUTH_COPY.supportEmail)[1]}
        </Text>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity
            style={styles.linkButton}
            accessibilityRole="link"
            accessibilityLabel="Back to sign in"
          >
            <Text style={styles.linkTextAccent}>Back to sign in</Text>
          </TouchableOpacity>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
