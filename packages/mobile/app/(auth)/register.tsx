import { useState, useRef, useCallback } from 'react';
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
  Alert,
  Modal,
  Pressable,
  type HostInstance,
  type TextInputInstance,
  AccessibilityInfo,
  findNodeHandle,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useAuthStore } from '@festie/shared/stores';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { registerErrorField, usernameError } from '@festie/shared/utils';
import { AUTH_COPY } from '@festie/shared/constants';
import Button from '../../components/Button';
import BrandMark from '../../components/BrandMark';
import InviteCard from '../../components/InviteCard';
import { getPendingInvite } from '../../lib/pendingInvite';
import { setReturnTo } from '../../lib/returnTo';
import { firstInvalidField, validateRegister, type RegisterErrors, type RegisterField } from '../../lib/registerValidation';
import { useReduceMotion } from '../../hooks/useReduceMotion';
import { makeStyles, typeScaleCap, typeStyle, useTokens, MAX_FONT_SCALE } from '../../hooks/useTokens';

// No in-app Terms route exists yet; open the canonical web Terms of Service,
// mirroring how the privacy screen links out to it.
const TERMS_URL = 'https://festie.us/terms.html';

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
    marginBottom: t.spacing[4],
  },
  label: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
    marginBottom: t.spacing[1],
  },
  fieldError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    marginTop: -t.spacing[2],
    marginBottom: t.spacing[2],
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
    marginBottom: t.spacing[3],
  },
  inputError: {
    borderColor: t.colors.text.danger,
  },
  inputFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  passwordRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    marginBottom: t.spacing[3],
    paddingRight: t.spacing[2],
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  eyeButton: {
    padding: t.spacing[2],
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginTop: -t.spacing[1],
    marginBottom: t.spacing[3],
  },
  tosRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  tosError: {
    marginTop: t.spacing[2],
  },
  tosCheckbox: {
    paddingTop: t.spacing[1],
  },
  tosTextWrap: {
    flex: 1,
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
  },
  tosText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  guestButton: {
    marginTop: t.spacing[5],
    alignItems: 'center' as const,
  },
  // Create-account CTA layout only — fill/ink/disabled live in components/Button (F8).
  button: {
    marginTop: t.spacing[2],
  },
  linkButton: {
    marginTop: t.spacing[5],
    alignItems: 'center' as const,
  },
  linkText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  linkTextAccent: {
    // Re-spread at 600 so the SemiBold cut loads (bare fontWeight fake-bolds
    // on Android over the weighted base family).
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  // DOB pressable — shares the same visual treatment as TextInput fields so the
  // form reads as one cohesive set of inputs.
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
  dobPressableError: {
    borderColor: t.colors.text.danger,
  },
  dobPressableFocused: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.ring.aqua,
  },
  dobText: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  dobPlaceholder: {
    ...typeStyle('body'),
    color: t.colors.text.placeholder,
  },
  // iOS modal overlay + picker card
  iosModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end' as const,
  },
  iosPickerCard: {
    backgroundColor: t.colors.bg.input,
    borderTopLeftRadius: t.radii.default,
    borderTopRightRadius: t.radii.default,
    // paddingBottom is applied inline (styles.iosPickerCard + runtime insets.bottom)
    // so the spinner isn't clipped behind the iPhone home indicator.
  },
  iosPickerHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[4],
    paddingBottom: t.spacing[2],
  },
  iosPickerLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  iosPickerDone: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
}));

export default function RegisterScreen() {
  const styles = useStyles();
  const t = useTokens();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<RegisterErrors>({});
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tosAccepted, setTosAccepted] = useState(false);
  // null = not yet chosen; Date = the user's selection
  const [dob, setDob] = useState<Date | null>(null);
  const [showIosPicker, setShowIosPicker] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // R25: gate hero reveal on reduce-motion preference
  const reduceMotion = useReduceMotion();
  const register = useAuthStore((s) => s.register);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);

  // Drop an error left over from another auth screen (the store is shared).
  useFocusEffect(
    useCallback(() => {
      setError(null);
    }, [setError]),
  );

  const usernameRef = useRef<TextInputInstance>(null);
  const emailRef = useRef<TextInputInstance>(null);
  const dobRef = useRef<HostInstance>(null);
  const tosRef = useRef<HostInstance>(null);
  const passwordRef = useRef<TextInputInstance>(null);
  const confirmRef = useRef<TextInputInstance>(null);

  // iOS lacks Android's input ripple, so give TextInputs an explicit focus
  // affordance: accent border + subtle aqua ring (paired per token note).
  const [focusedField, setFocusedField] = useState<'username' | 'email' | 'password' | 'confirm' | null>(null);
  const onFocusOf = (field: NonNullable<typeof focusedField>) => () => setFocusedField(field);
  const onBlurOf = (field: NonNullable<typeof focusedField>) => () => setFocusedField((f) => (f === field ? null : f));

  /** Format a Date to the 'YYYY-MM-DD' string the backend expects. */
  const toIso = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  /** Display label shown in the pressable field once a date is selected. */
  const dobLabel = dob
    ? dob.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : null;

  const today = new Date();
  const defaultDob = new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());

  // Clears one field's error as soon as the user edits it.
  const clearError = (field: RegisterField) => setErrors((prev) => ({ ...prev, [field]: undefined }));

  const focusField = (field: RegisterField) => {
    const inputs = { username: usernameRef, email: emailRef, password: passwordRef, confirmPassword: confirmRef };
    if (field in inputs) {
      inputs[field as keyof typeof inputs].current?.focus();
      return;
    }
    // DOB and the Terms checkbox are not text inputs: move the screen reader there.
    const node = findNodeHandle((field === 'dob' ? dobRef : tosRef).current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  };

  const openAndroidPicker = () => {
    DateTimePickerAndroid.open({
      value: dob ?? defaultDob,
      mode: 'date',
      maximumDate: today,
      onChange: (_evt, selected) => {
        if (selected) {
          setDob(selected);
          clearError('dob');
        }
      },
    });
  };

  const handleRegister = async () => {
    Keyboard.dismiss();
    const found = validateRegister({ username, email, password, confirmPassword, dob, tosAccepted });
    setErrors(found);
    const first = firstInvalidField(found);
    if (first) {
      focusField(first);
      return;
    }
    setError(null);
    try {
      const { emailVerificationSent } = await register({
        username: username.trim(),
        email: email.trim(),
        password,
        confirmPassword,
        tosAccepted,
        dateOfBirth: toIso(dob!),
      });
      if (emailVerificationSent) {
        Alert.alert(AUTH_COPY.accountCreated, AUTH_COPY.checkEmailToConfirm(email.trim()));
      }
      // A guest who arrived through an invite link finishes that join first.
      const invite = getPendingInvite();
      if (invite) {
        setReturnTo(null);
        router.replace(`/join/${invite}`);
      }
    } catch (err) {
      // Show a field-specific server error under its field; the rest stays in the store error.
      const msg = mapErrorToUserMessage(err, "Couldn't create your account. Try again.");
      const field = registerErrorField(msg);
      if (field) {
        setErrors((prev) => ({ ...prev, [field]: msg }));
        setError(null);
        focusField(field);
      }
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
        {/* R25: hero staggered reveal — brand word then subtitle, gated on reduceMotion */}
        <BrandMark />
        <Animated.Text
          style={styles.title}
          maxFontSizeMultiplier={typeScaleCap('display-lg')}
          entering={reduceMotion ? undefined : FadeInDown.delay(300).duration(350)}>
          {AUTH_COPY.wordmark}
        </Animated.Text>
        <Animated.Text
          style={styles.subtitle}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          entering={reduceMotion ? undefined : FadeInDown.delay(360).duration(350)}
        >
          {AUTH_COPY.tagline}
        </Animated.Text>
        <Animated.Text
          style={styles.screenLine}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          entering={reduceMotion ? undefined : FadeInDown.delay(360).duration(350)}
        >
          Create your account
        </Animated.Text>

        <InviteCard code={getPendingInvite()} />

        {/* Field labels are visible only: each control carries its own accessibilityLabel. */}
        <Text style={styles.label} accessible={false} importantForAccessibility="no">
          Username
        </Text>
        <TextInput
          ref={usernameRef}
          style={[
            styles.input,
            focusedField === 'username' && styles.inputFocused,
            errors.username ? styles.inputError : undefined,
          ]}
          placeholder="Username"
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Username"
          accessibilityHint={errors.username}
          value={username}
          onChangeText={(v) => {
            setUsername(v);
            clearError('username');
          }}
          autoCapitalize="none"
          autoComplete="username-new"
          textContentType="username"
          returnKeyType="next"
          onFocus={onFocusOf('username')}
          onBlur={() => {
            onBlurOf('username')();
            if (username.trim()) {
              const rule = usernameError(username);
              if (rule) setErrors((prev) => ({ ...prev, username: rule }));
            }
          }}
          onSubmitEditing={() => emailRef.current?.focus()}
          blurOnSubmit={false}
        />
        {errors.username ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.username}
          </Text>
        ) : null}
        <Text style={styles.hint}>{AUTH_COPY.usernameHint}</Text>

        <Text style={styles.label} accessible={false} importantForAccessibility="no">
          {AUTH_COPY.emailLabel}
        </Text>
        <TextInput
          ref={emailRef}
          style={[
            styles.input,
            focusedField === 'email' && styles.inputFocused,
            errors.email ? styles.inputError : undefined,
          ]}
          placeholder={AUTH_COPY.emailLabel}
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Email address, required for password reset"
          accessibilityHint={errors.email}
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            clearError('email');
          }}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onFocus={onFocusOf('email')}
          onBlur={onBlurOf('email')}
          onSubmitEditing={() => passwordRef.current?.focus()}
          blurOnSubmit={false}
        />
        {errors.email ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.email}
          </Text>
        ) : null}
        <Text style={styles.hint}>{AUTH_COPY.emailHint}</Text>

        <Text style={styles.label} accessible={false} importantForAccessibility="no">
          Password
        </Text>
        <View
          style={[
            styles.passwordRow,
            focusedField === 'password' && styles.inputFocused,
            errors.password ? styles.inputError : undefined,
          ]}
        >
          <TextInput
            ref={passwordRef}
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor={t.colors.text.placeholder}
            accessibilityLabel="Password"
            accessibilityHint={errors.password}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              clearError('password');
            }}
            secureTextEntry={!showPw}
            autoComplete="password-new"
            textContentType="newPassword"
            returnKeyType="next"
            onFocus={onFocusOf('password')}
            onBlur={onBlurOf('password')}
            onSubmitEditing={() => confirmRef.current?.focus()}
            blurOnSubmit={false}
          />
          <TouchableOpacity
            onPress={() => setShowPw((v) => !v)}
            style={styles.eyeButton}
            accessibilityRole="button"
            accessibilityLabel={showPw ? 'Hide password' : 'Show password'}
          >
            <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={20} color={t.colors.text.secondary} />
          </TouchableOpacity>
        </View>
        {errors.password ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.password}
          </Text>
        ) : null}
        <Text style={styles.hint}>At least 8 characters. Avoid common passwords and your name.</Text>

        <Text style={styles.label} accessible={false} importantForAccessibility="no">
          Confirm password
        </Text>
        <TextInput
          ref={confirmRef}
          style={[
            styles.input,
            focusedField === 'confirm' && styles.inputFocused,
            errors.confirmPassword ? styles.inputError : undefined,
          ]}
          placeholder="Confirm password"
          placeholderTextColor={t.colors.text.placeholder}
          accessibilityLabel="Confirm password"
          accessibilityHint={errors.confirmPassword}
          value={confirmPassword}
          onChangeText={(v) => {
            setConfirmPassword(v);
            clearError('confirmPassword');
          }}
          secureTextEntry={!showPw}
          autoComplete="password-new"
          textContentType="newPassword"
          returnKeyType="go"
          onFocus={onFocusOf('confirm')}
          onBlur={onBlurOf('confirm')}
          onSubmitEditing={handleRegister}
        />
        {errors.confirmPassword ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.confirmPassword}
          </Text>
        ) : null}

        {/* DOB — Android opens the system date picker imperatively; iOS renders
            a spinner inside a bottom-sheet modal to avoid the inline-picker
            height collapse issue on Expo SDK 56. */}
        <Text style={styles.label} accessible={false} importantForAccessibility="no">
          Date of birth
        </Text>
        <Pressable
          ref={dobRef}
          onPress={Platform.OS === 'android' ? openAndroidPicker : () => setShowIosPicker(true)}
          style={[
            styles.dobPressable,
            errors.dob ? styles.dobPressableError : undefined,
          ]}
          accessibilityRole="button"
          accessibilityLabel={dobLabel ? `Date of birth: ${dobLabel}` : 'Date of birth, required'}
          accessibilityHint={
            errors.dob ? `${errors.dob}. Opens a date picker.` : 'Opens a date picker. You must be 18 or older.'
          }
        >
          <Text style={dobLabel ? styles.dobText : styles.dobPlaceholder}>
            {dobLabel ?? 'Date of birth'}
          </Text>
          <Ionicons name="calendar-outline" size={20} color={t.colors.text.secondary} />
        </Pressable>
        {errors.dob ? (
          <Text style={styles.fieldError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.dob}
          </Text>
        ) : null}

        <View style={styles.tosRow}>
          <TouchableOpacity
            ref={tosRef}
            onPress={() => {
              setTosAccepted((v) => !v);
              clearError('tosAccepted');
            }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: tosAccepted }}
            accessibilityLabel="I agree to the Terms of Service and Privacy Policy"
            accessibilityHint={
              errors.tosAccepted ??
              'Toggles acceptance. The Terms of Service and Privacy Policy links are available separately.'
            }
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
              <Text style={[styles.tosText, styles.linkTextAccent]}>Terms of Service</Text>
            </TouchableOpacity>
            <Text style={styles.tosText}> &amp; </Text>
            <TouchableOpacity
              onPress={() => router.push('/privacy')}
              accessibilityRole="link"
              accessibilityLabel="Read the Privacy Policy"
            >
              <Text style={[styles.tosText, styles.linkTextAccent]}>Privacy Policy</Text>
            </TouchableOpacity>
          </View>
        </View>

        {errors.tosAccepted ? (
          <Text style={[styles.fieldError, styles.tosError]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {errors.tosAccepted}
          </Text>
        ) : null}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}

        <Button
          label={AUTH_COPY.createAccount}
          onPress={handleRegister}
          loading={isLoading}
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
          style={styles.button}
        />

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity
            style={styles.linkButton}
            accessibilityRole="link"
            accessibilityLabel="Sign in to an existing account"
          >
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkTextAccent}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </Link>

        <TouchableOpacity
          style={styles.guestButton}
          onPress={() => router.replace('/(tabs)')}
          accessibilityRole="button"
          accessibilityLabel="Browse without an account"
        >
          <Text style={styles.linkText}>Browse without an account</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* iOS bottom-sheet date picker — only rendered on iOS */}
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
              // Prevent overlay tap-through closing when tapping the card itself.
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.iosPickerHeader}>
                <Text style={styles.iosPickerLabel}>Date of birth</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (!dob) {
                      setDob(defaultDob);
                      clearError('dob');
                    }
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
                  if (selected) {
                    setDob(selected);
                    clearError('dob');
                  }
                }}
                // Ensure the spinner respects the dark background.
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
