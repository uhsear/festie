import { useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, type TextInputInstance } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore, useUIStore } from '@festie/shared/stores';
import { ACCOUNT_COPY } from '@festie/shared/constants';
import { isValidEmail } from '@festie/shared/utils';
import { mapErrorToUserMessage, withReauth } from '@festie/shared/services';
import Button from './Button';
import { useReauthPrompt } from './admin';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

/**
 * Add or change the account email from the Account screen.
 *
 * Calls authStore.requestEmailChange (POST /account/email). The server mails a
 * link to the new address; the login email changes only when that link opens,
 * so the user object here stays the same after a successful send.
 *
 * A provider-only account (hasPassword false) has no password field: the request runs
 * through withReauth, so the user confirms with Google or Apple instead.
 */
export default function AccountEmailSection({ hasPassword }: { hasPassword: boolean }) {
  const t = useTokens();
  const offlineMode = useUIStore((s) => s.offlineMode);
  const styles = useStyles();
  const haptics = useHaptics();
  const user = useAuthStore((s) => s.user);
  const { ask, reauthDialog } = useReauthPrompt();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const current = user?.email ?? null;

  const toggle = () => {
    if (!open) setSentTo(null);
    setEmail('');
    setPassword('');
    setError(null);
    setOpen(!open);
  };

  const validate = (): string | null => {
    const clean = email.trim();
    if (!isValidEmail(clean)) return ACCOUNT_COPY.emailInvalid;
    if (current && clean.toLowerCase() === current.toLowerCase()) return ACCOUNT_COPY.emailSame;
    if (hasPassword && !password) return ACCOUNT_COPY.emailPasswordRequired;
    return null;
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      haptics.warning();
      return;
    }
    const clean = email.trim();
    setSubmitting(true);
    setError(null);
    try {
      const send = () => useAuthStore.getState().requestEmailChange(clean, hasPassword ? password : undefined);
      const done = hasPassword ? await send() : await withReauth(send, ask);
      if (done === null) return;
      haptics.success();
      setEmail('');
      setPassword('');
      setOpen(false);
      setSentTo(clean);
      await useAuthStore.getState().checkSession();
    } catch (err) {
      haptics.warning();
      setError(mapErrorToUserMessage(err, ACCOUNT_COPY.emailSendFailed));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.row}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${ACCOUNT_COPY.emailLabel}: ${current ?? ACCOUNT_COPY.emailNotSet}. ${
          current ? ACCOUNT_COPY.emailChange : ACCOUNT_COPY.emailAdd
        }`}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="mail-outline" size={20} color={t.colors.text.secondary} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{ACCOUNT_COPY.emailLabel}</Text>
          <Text style={styles.rowHint} numberOfLines={1} ellipsizeMode="middle">
            {current ?? ACCOUNT_COPY.emailNotSet}
          </Text>
        </View>
        <Text style={styles.action}>{current ? ACCOUNT_COPY.emailChange : ACCOUNT_COPY.emailAdd}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.placeholder} />
      </TouchableOpacity>

      {!current && !open ? <Text style={styles.prompt}>{ACCOUNT_COPY.emailAddPrompt}</Text> : null}

      {sentTo && !open ? (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={14} color={t.colors.status.verified} style={styles.noticeIcon} />
          <Text style={styles.noticeText}>{ACCOUNT_COPY.emailSent(sentTo)}</Text>
        </View>
      ) : null}

      {user?.pendingEmail && !sentTo && !open ? (
        <View style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.rowHint}>{ACCOUNT_COPY.emailPending(user.pendingEmail)}</Text>
        </View>
      ) : null}

      {open ? (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder={ACCOUNT_COPY.emailNewLabel}
            placeholderTextColor={t.colors.text.placeholder}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            editable={!submitting}
            accessibilityLabel={ACCOUNT_COPY.emailNewLabel}
            returnKeyType={hasPassword ? 'next' : 'go'}
            onSubmitEditing={() => (hasPassword ? passwordRef.current?.focus() : void submit())}
            blurOnSubmit={!hasPassword}
          />
          {hasPassword ? (
            <TextInput
              ref={passwordRef}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={ACCOUNT_COPY.emailCurrentPasswordLabel}
              placeholderTextColor={t.colors.text.placeholder}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              editable={!submitting}
              accessibilityLabel={ACCOUNT_COPY.emailCurrentPasswordLabel}
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
            />
          ) : null}
          <Text style={styles.rowHint}>{ACCOUNT_COPY.emailExplainer}</Text>

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Button label={ACCOUNT_COPY.emailSendLink} onPress={() => void submit()} loading={submitting} disabled={offlineMode} />
        </View>
      ) : null}
      {reauthDialog}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    minHeight: 56,
  },
  rowIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: t.spacing[1],
  },
  rowTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  rowHint: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  action: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  prompt: {
    ...typeStyle('caption'),
    color: t.colors.accent.amber,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[3],
  },
  noticeIcon: {
    marginRight: t.spacing[1],
  },
  noticeText: {
    ...typeStyle('caption'),
    color: t.colors.status.verified,
    flexShrink: 1,
  },
  form: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  input: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    backgroundColor: t.colors.bg.primary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 48,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
}));
