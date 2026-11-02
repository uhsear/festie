import { useEffect, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useAuthStore } from '@festie/shared/stores';
import { isApiClientError, mapErrorToUserMessage } from '@festie/shared/services';
import { REGISTER_COPY, isAtLeast18, registerErrorField, usernameError } from '@festie/shared/utils';
import { AUTH_COPY, PROVIDER_COPY } from '@festie/shared/constants';
import type { ProviderSignupPayload } from '@festie/shared/types';
import Button from '../../components/Button';
import BrandMark from '../../components/BrandMark';
import { takePendingSignup } from '../../components/ProviderButtons';
import { getPendingInvite } from '../../lib/pendingInvite';
import { setReturnTo } from '../../lib/returnTo';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';

const TERMS_URL = 'https://festie.us/terms.html';

const useStyles = makeStyles((t) => ({
  container: { flex: 1, backgroundColor: t.colors.bg.primary },
  inner: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: t.spacing[6] },
  title: { ...typeStyle('display-lg'), color: t.colors.accent.coral, textAlign: 'center', marginBottom: t.spacing[1] },
  body: { ...typeStyle('body'), color: t.colors.text.secondary, textAlign: 'center', marginBottom: t.spacing[6] },
  error: { ...typeStyle('label'), color: t.colors.text.danger, textAlign: 'center', marginBottom: t.spacing[4] },
  label: { ...typeStyle('label', 600), color: t.colors.text.primary, marginBottom: t.spacing[1] },
  fieldError: { ...typeStyle('label'), color: t.colors.text.danger, marginBottom: t.spacing[3] },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
    marginBottom: t.spacing[3],
  },
  inputError: { borderColor: t.colors.text.danger },
  hint: { ...typeStyle('caption'), color: t.colors.text.muted, marginTop: -t.spacing[1], marginBottom: t.spacing[3] },
  dobPressable: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    marginBottom: t.spacing[3],
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  dobText: { ...typeStyle('body'), color: t.colors.text.primary },
  dobPlaceholder: { ...typeStyle('body'), color: t.colors.text.placeholder },
  tosRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: t.spacing[2], marginTop: t.spacing[1] },
  tosCheckbox: {
    minWidth: Platform.OS === 'android' ? 48 : 44,
    minHeight: Platform.OS === 'android' ? 48 : 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  tosTextWrap: { flex: 1, flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const },
  tosText: { ...typeStyle('label'), color: t.colors.text.secondary },
  linkTextAccent: { ...typeStyle('label', 600), color: t.colors.accent.aqua },
  button: { marginTop: t.spacing[4] },
  iosModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' as const },
  iosPickerCard: {
    backgroundColor: t.colors.bg.input,
    borderTopLeftRadius: t.radii.default,
    borderTopRightRadius: t.radii.default,
  },
  iosPickerHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[4],
    paddingBottom: t.spacing[2],
  },
  iosPickerLabel: { ...typeStyle('label', 600), color: t.colors.text.primary },
  iosPickerDone: { ...typeStyle('label', 600), color: t.colors.accent.aqua },
}));

type Errors = { username?: string; dateOfBirth?: string; tosAccepted?: string };

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function CompleteSignupScreen() {
  const styles = useStyles();
  const t = useTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { k } = useLocalSearchParams<{ k?: string }>();
  const completeProviderSignup = useAuthStore((s) => s.completeProviderSignup);
  // takePendingSignup deletes the entry, so keep the first read in state across re-renders.
  const [payload] = useState<ProviderSignupPayload | undefined>(() => takePendingSignup(k));
  const [username, setUsername] = useState(payload?.suggestedUsername ?? '');
  const [dob, setDob] = useState<Date | null>(null);
  const [tosAccepted, setTosAccepted] = useState(false);
  const [showIosPicker, setShowIosPicker] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const backToLogin = (message: string) => {
    router.replace('/(auth)/login');
    Alert.alert(message);
  };

  // The payload lives in memory only; after an app restart there is nothing to finish.
  useEffect(() => {
    if (!payload) backToLogin(PROVIDER_COPY.signupExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!payload) return null;

  const today = new Date();
  const defaultDob = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
  const dobLabel = dob?.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) ?? null;

  const pickDob = (d: Date) => {
    setDob(d);
    setErrors((e) => ({ ...e, dateOfBirth: undefined }));
  };

  const openAndroidPicker = () =>
    DateTimePickerAndroid.open({
      value: dob ?? defaultDob,
      mode: 'date',
      maximumDate: today,
      onChange: (_evt, selected) => {
        if (selected) pickDob(selected);
      },
    });

  const submit = async () => {
    const found: Errors = {};
    const name = username.trim();
    const nameRule = name ? usernameError(name) : REGISTER_COPY.usernameRequired;
    if (nameRule) found.username = nameRule;
    if (!dob) found.dateOfBirth = REGISTER_COPY.dobRequired;
    else if (!isAtLeast18(toIso(dob))) found.dateOfBirth = REGISTER_COPY.under18;
    if (!tosAccepted) found.tosAccepted = REGISTER_COPY.tosRequired;
    setErrors(found);
    if (!dob || Object.keys(found).length > 0) return;
    setBusy(true);
    setFormError(null);
    try {
      const { emailVerificationSent } = await completeProviderSignup({
        signupToken: payload.signupToken,
        username: name,
        dateOfBirth: toIso(dob),
        tosAccepted: true,
      });
      if (emailVerificationSent && payload.email) {
        Alert.alert(AUTH_COPY.accountCreated, AUTH_COPY.checkEmailToConfirm(payload.email));
      }
      // A guest who arrived through an invite link finishes that join first.
      const invite = getPendingInvite();
      if (invite) {
        setReturnTo(null);
        router.replace(`/join/${invite}`);
      }
    } catch (err) {
      if (isApiClientError(err) && err.code === 'SIGNUP_EXPIRED') {
        backToLogin(PROVIDER_COPY.signupExpired);
        return;
      }
      const msg = mapErrorToUserMessage(err, 'Could not create your account. Try again.');
      if (registerErrorField(msg) === 'username') setErrors((e) => ({ ...e, username: msg }));
      else setFormError(msg);
    } finally {
      setBusy(false);
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
        <Text style={styles.title} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
          {PROVIDER_COPY.finishTitle}
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {PROVIDER_COPY.finishBody}
        </Text>

        {formError ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {formError}
          </Text>
        ) : null}

        <Text style={styles.label} accessible={false} importantForAccessibility="no">
          Username
        </Text>
        <TextInput
          style={[styles.input, errors.username ? styles.inputError : undefined]}
          placeholder="Username"
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Username"
          accessibilityHint={errors.username}
          value={username}
          onChangeText={(v) => {
            setUsername(v);
            setErrors((e) => ({ ...e, username: undefined }));
          }}
          autoCapitalize="none"
          autoComplete="username-new"
          textContentType="username"
          returnKeyType="done"
        />
        {errors.username ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.username}
          </Text>
        ) : null}
        <Text style={styles.hint}>{AUTH_COPY.usernameHint}</Text>

        <Text style={styles.label} accessible={false} importantForAccessibility="no">
          Date of birth
        </Text>
        <Pressable
          onPress={Platform.OS === 'android' ? openAndroidPicker : () => setShowIosPicker(true)}
          style={styles.dobPressable}
          accessibilityRole="button"
          accessibilityLabel={dobLabel ? `Date of birth: ${dobLabel}` : 'Date of birth, required'}
          accessibilityHint={errors.dateOfBirth ?? 'Opens a date picker. You must be 18 or older.'}
        >
          <Text style={dobLabel ? styles.dobText : styles.dobPlaceholder}>{dobLabel ?? 'Date of birth'}</Text>
          <Ionicons name="calendar-outline" size={20} color={t.colors.text.secondary} />
        </Pressable>
        {errors.dateOfBirth ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.dateOfBirth}
          </Text>
        ) : null}

        <View style={styles.tosRow}>
          <TouchableOpacity
            onPress={() => {
              setTosAccepted((v) => !v);
              setErrors((e) => ({ ...e, tosAccepted: undefined }));
            }}
            activeOpacity={0.7}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tosAccepted }}
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            accessibilityHint={errors.tosAccepted}
            style={styles.tosCheckbox}
          >
            <Ionicons
              name={tosAccepted ? 'checkbox' : 'square-outline'}
              size={20}
              color={tosAccepted ? t.colors.accent.aqua : t.colors.text.secondary}
            />
          </TouchableOpacity>
          <View style={styles.tosTextWrap}>
            <Text style={styles.tosText}>I agree to the </Text>
            <TouchableOpacity
              onPress={() => void Linking.openURL(TERMS_URL)}
              accessibilityRole="link"
              accessibilityLabel="Read the Terms of Service, opens in browser"
            >
              <Text style={styles.linkTextAccent}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.tosText}> &amp; </Text>
            <TouchableOpacity
              onPress={() => router.push('/privacy')}
              accessibilityRole="link"
              accessibilityLabel="Read the Privacy Policy"
            >
              <Text style={styles.linkTextAccent}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>
        {errors.tosAccepted ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.tosAccepted}
          </Text>
        ) : null}

        <Button
          label={PROVIDER_COPY.finishButton}
          onPress={submit}
          loading={busy}
          accessibilityState={{ disabled: busy, busy }}
          style={styles.button}
        />
      </ScrollView>

      {Platform.OS === 'ios' && (
        <Modal
          visible={showIosPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowIosPicker(false)}
          accessibilityViewIsModal
        >
          <Pressable style={styles.iosModalOverlay} onPress={() => setShowIosPicker(false)}>
            <Pressable
              style={[styles.iosPickerCard, { paddingBottom: t.spacing[6] + insets.bottom }]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.iosPickerHeader}>
                <Text style={styles.iosPickerLabel}>Date of birth</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (!dob) pickDob(defaultDob);
                    setShowIosPicker(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Done"
                >
                  <Text style={styles.iosPickerDone}>Done</Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={dob ?? defaultDob}
                mode="date"
                display="spinner"
                maximumDate={today}
                onChange={(_evt, selected) => {
                  if (selected) pickDob(selected);
                }}
                themeVariant="dark"
                textColor={t.colors.text.primary}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}
