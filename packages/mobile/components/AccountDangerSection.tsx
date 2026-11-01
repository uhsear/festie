import { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useAuthStore,
  useCrewStore,
  ACCOUNT_DELETION_EXPLAINER,
  accountDeletionNotice,
} from '@festie/shared/stores';
import type { CrewMember } from '@festie/shared/types';
import { crewCopy, ownedCrewsForDeletion, type OwnedCrewHandover } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';

interface AccountDangerSectionProps {
  /** Called after a successful delete (store + token already cleared) so the
   *  screen can route to login. */
  onDeleted: () => void;
}

/**
 * Danger-zone (account deletion) for the Account screen.
 *
 * Wired to the shared authStore.deleteAccount(password, crewHandover) → DELETE /account/
 * with { password, crewHandover }. Owners pick who takes over each crew with
 * other members; the server falls back to the first joiner. The server schedules deletion for 30 days out and keeps
 * picks and notes until then; signing in before that cancels it. The shared
 * action calls logout() on success (clearing the token + resetting all stores)
 * and returns the deletion date. This component shows that date, then invokes
 * onDeleted to route to login.
 *
 * Flow: expand the danger row → enter the account password → a double-confirm
 * Alert spells out the 30-day window → on confirm we call deleteAccount.
 * A wrong password surfaces inline (server returns PASSWORD_INCORRECT / 403).
 */
export default function AccountDangerSection({ onDeleted }: AccountDangerSectionProps) {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const user = useAuthStore((s) => s.user);
  const crews = useCrewStore((s) => s.crews);
  const loadCrews = useCrewStore((s) => s.loadCrews);

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // crewId -> chosen new owner; a crew with no entry uses its default (first joiner).
  const [chosenOwners, setChosenOwners] = useState<Record<string, string>>({});

  const { handover, soloCount } = useMemo(
    () => (user ? ownedCrewsForDeletion(crews, user.id) : { handover: [], soloCount: 0 }),
    [crews, user],
  );
  const ownerFor = (h: OwnedCrewHandover) => chosenOwners[h.crew.id] ?? h.defaultOwnerId;
  const memberLabel = (m: CrewMember) => m.name || m.username || 'Member';

  const reset = () => {
    setPassword('');
    setError(null);
    setChosenOwners({});
  };

  const toggle = () => {
    setOpen((prev) => {
      if (!prev) {
        haptics.warning();
        if (crews.length === 0) loadCrews().catch(() => {});
      } else reset();
      return !prev;
    });
  };

  const pickOwner = (h: OwnedCrewHandover) =>
    Alert.alert(crewCopy.newOwnerFor(h.crew.name), undefined, [
      ...h.candidates.slice(0, 10).map((m) => ({
        text: memberLabel(m),
        onPress: () => setChosenOwners((prev) => ({ ...prev, [h.crew.id]: m.userId })),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  const confirmDelete = () => {
    if (!password) {
      setError('Enter your password to confirm.');
      return;
    }
    setError(null);
    haptics.warning();
    Alert.alert(
      'Delete account?',
      'We delete your account in 30 days. Sign in before then to cancel.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Account',
          style: 'destructive',
          onPress: () => void handleDelete(),
        },
      ],
    );
  };

  const handleDelete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { deletionDate } = await deleteAccount(
        password,
        handover.map((h) => ({ crewId: h.crew.id, newOwnerId: ownerFor(h) })),
      );
      // deleteAccount → logout already cleared token + reset stores.
      Alert.alert('Account deletion scheduled', accountDeletionNotice(deletionDate));
      onDeleted();
    } catch (err) {
      haptics.warning();
      setError(err instanceof Error ? err.message : 'Could not delete account.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.card, open && styles.cardOpen]}>
      <TouchableOpacity
        style={styles.row}
        onPress={toggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Hide delete account form' : 'Delete account'}
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.rowIcon}>
          <Ionicons name="trash-outline" size={20} color={t.colors.text.danger} />
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, styles.dangerText]}>Delete Account</Text>
          <Text style={styles.rowHint}>Deleted 30 days after you ask</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-forward'} size={18} color={t.colors.text.danger} />
      </TouchableOpacity>

      {open ? (
        <View style={styles.form}>
          {/* Spell out exactly what deletion touches before they commit. */}
          <View style={styles.callout}>
            <Ionicons name="warning" size={16} color={t.colors.accent.coral} style={styles.calloutIcon} />
            <View style={styles.calloutBody}>
              <Text style={styles.calloutTitle}>Deleted after 30 days</Text>
              <Text style={styles.calloutText}>{ACCOUNT_DELETION_EXPLAINER}</Text>
            </View>
          </View>

          {handover.length > 0 ? (
            <View style={styles.owned}>
              <Text style={styles.calloutTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>{crewCopy.deleteOwnedTitle}</Text>
              <Text style={styles.calloutText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{crewCopy.deleteOwnedBody}</Text>
              {handover.map((h) => {
                const owner = h.candidates.find((m) => m.userId === ownerFor(h));
                return (
                  <TouchableOpacity
                    key={h.crew.id}
                    style={styles.ownedRow}
                    onPress={() => pickOwner(h)}
                    disabled={submitting}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`${h.crew.name}. New owner: ${owner ? memberLabel(owner) : 'none'}. Change`}
                  >
                    <View style={styles.rowBody}>
                      <Text style={styles.rowTitle} maxFontSizeMultiplier={MAX_FONT_SCALE}>{h.crew.name}</Text>
                      <Text style={styles.rowHint} maxFontSizeMultiplier={MAX_FONT_SCALE}>New owner: {owner ? memberLabel(owner) : 'None'}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={t.colors.text.secondary} />
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          {soloCount > 0 ? <Text style={styles.calloutText} maxFontSizeMultiplier={MAX_FONT_SCALE}>{crewCopy.deleteSolo(soloCount)}</Text> : null}

          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Confirm your password"
            placeholderTextColor={t.colors.text.placeholder}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            editable={!submitting}
            returnKeyType="done"
            onSubmitEditing={confirmDelete}
            accessibilityLabel="Account password to confirm deletion"
          />

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.submit, submitting && styles.submitDisabled]}
            onPress={confirmDelete}
            disabled={submitting}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
            accessibilityState={{ disabled: submitting }}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={t.colors.text.onAccent} />
            ) : (
              <>
                <Ionicons name="trash" size={16} color={t.colors.text.onAccent} style={styles.submitIcon} />
                <Text style={styles.submitText}>Delete My Account</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
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
  // When expanded the card takes a coral hairline so it visibly reads as the
  // armed danger zone, not just another settings row.
  cardOpen: {
    borderColor: t.colors.ring.coral,
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
  dangerText: {
    color: t.colors.text.danger,
  },
  form: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  callout: {
    flexDirection: 'row',
    gap: t.spacing[2],
    backgroundColor: t.colors.ring.coral,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.ring.coral,
    padding: t.spacing[3],
  },
  calloutIcon: {
    marginTop: 1,
  },
  calloutBody: {
    flex: 1,
    gap: 2,
  },
  calloutTitle: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
  calloutText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  owned: {
    gap: t.spacing[2],
  },
  ownedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    minHeight: 56,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
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
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.accent.coralStrong,
    borderRadius: t.radii.default,
    minHeight: 48,
    paddingHorizontal: t.spacing[4],
  },
  submitDisabled: {
    opacity: 0.6,
  },
  submitIcon: {
    marginRight: t.spacing[2],
  },
  submitText: {
    ...typeStyle('label'),
    color: t.colors.text.onAccent,
  },
}));
