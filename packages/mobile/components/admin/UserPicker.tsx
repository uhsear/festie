import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, FlatList } from 'react-native';
import { fetchAdminUsers, type AdminUserRow } from '@festie/shared/services';
import { maskEmail } from '@festie/shared/utils';
import { LabeledTextInput } from './AdminFields';
import { makeStyles, typeStyle } from '../../hooks/useTokens';

/**
 * Admin user picker: search every user, tap Add. Mirrors the web
 * UserPickerDialog. The parent closes it after a successful pick; a failed
 * pick shows its message here.
 */
export interface UserPickerProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  existingUserIds?: string[];
  /** When set, shown in place of the Add buttons' effect: every Add is disabled. */
  fullMessage?: string | null;
  onPick: (user: AdminUserRow) => Promise<void>;
}

const SEARCH_DEBOUNCE_MS = 300;

export default function UserPicker({
  visible,
  onClose,
  title,
  existingUserIds = [],
  fullMessage,
  onPick,
}: UserPickerProps) {
  const styles = useStyles();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminUserRow[]>([]);
  const [searched, setSearched] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      fetchAdminUsers({ search: query.trim(), limit: 10 })
        .then(({ users }) => {
          if (id !== requestId.current) return;
          setResults(users);
          setSearched(query.trim());
          setError(null);
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          setError(err instanceof Error ? err.message : "Couldn't search users. Try again.");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visible, query]);

  const handleClose = () => {
    if (pickingId) return;
    setQuery('');
    setResults([]);
    setError(null);
    onClose();
  };

  const pick = async (user: AdminUserRow) => {
    setPickingId(user.id);
    setError(null);
    try {
      await onPick(user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Action failed. Try again.');
    } finally {
      setPickingId(null);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable style={styles.backdrop} onPress={handleClose} accessible={false} />
        <View style={styles.card} accessibilityViewIsModal>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <LabeledTextInput
            label="Search by username or email"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
          />
          {fullMessage ? <Text style={styles.warn}>{fullMessage}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <FlatList
            data={results}
            keyExtractor={(u) => u.id}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            ListEmptyComponent={
              <Text style={styles.hint}>{searched ? `No users match "${searched}".` : ''}</Text>
            }
            renderItem={({ item: user }) => {
              const isMember = existingUserIds.includes(user.id);
              const adding = pickingId === user.id;
              return (
                <View style={styles.row}>
                  <View style={styles.meta}>
                    <Text style={styles.name} numberOfLines={1}>
                      @{user.username}
                    </Text>
                    <Text style={styles.hint} numberOfLines={1}>
                      {maskEmail(user.email)}
                    </Text>
                  </View>
                  {isMember ? (
                    <Text style={styles.hint}>Already in crew</Text>
                  ) : (
                    <TouchableOpacity
                      style={[styles.addButton, (!!fullMessage || !!pickingId) && styles.addDisabled]}
                      disabled={!!fullMessage || !!pickingId}
                      onPress={() => void pick(user)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${user.username}`}
                    >
                      <Text style={styles.addLabel}>{adding ? 'Adding…' : 'Add'}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            }}
          />
          <TouchableOpacity
            style={styles.doneButton}
            onPress={handleClose}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Text style={styles.doneLabel}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  scrim: {
    flex: 1,
    backgroundColor: t.colors.shade[10],
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: t.spacing[5],
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.lg,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    padding: t.spacing[5],
    maxHeight: '85%',
    gap: t.spacing[3],
  },
  title: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  meta: {
    flex: 1,
    gap: t.spacing[1],
  },
  name: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  warn: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  addButton: {
    minHeight: 44,
    minWidth: 64,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[4],
    backgroundColor: t.colors.accent.aqua,
  },
  addDisabled: {
    opacity: 0.5,
  },
  addLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
  doneButton: {
    minHeight: 48,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  doneLabel: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
}));
