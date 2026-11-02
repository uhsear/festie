import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Alert } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@festie/shared/hooks';
import { AVATAR_COPY, ACCOUNT_COPY } from '@festie/shared/constants';
import { mapErrorToUserMessage } from '@festie/shared/services';
import { useAuthStore } from '@festie/shared/stores';
import { displayInitials, identityLabel } from '@festie/shared/utils';
import { makeStyles, typeStyle, useTokens, MAX_FONT_SCALE } from '../hooks/useTokens';
import { useHaptics } from '../hooks/useHaptics';
import { useReduceMotion } from '../hooks/useReduceMotion';

/**
 * The one identity block on the Account screen: avatar (tap to change the
 * photo), name, @handle, email, status chips, and the upload state line.
 *
 * Wired to the shared, platform-neutral store methods:
 *   - useAuth().uploadAvatar(file) → POST /account/avatar (FormData field
 *     `avatar`), updates user.avatarUrl with rollback. The size and type check
 *     lives inside uploadAvatar, so its message reaches the error line here.
 *   - useAuth().removeAvatar()     → DELETE /account/avatar.
 *
 * Only the file-acquisition step is native-specific. expo-image-picker is loaded
 * lazily via dynamic import() so the bundle/typecheck does not hard-depend on it;
 * if the native module isn't present we surface a clear message instead of crashing.
 */

// Minimal shape of the parts of expo-image-picker we use — declared locally so
// the optional dependency does not need to be installed for typecheck to pass.
interface ImagePickerAsset {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
}
interface ImagePickerResult {
  canceled: boolean;
  assets?: ImagePickerAsset[] | null;
}
interface ImagePickerModule {
  requestMediaLibraryPermissionsAsync: () => Promise<{ granted: boolean }>;
  launchImageLibraryAsync: (options?: {
    mediaTypes?: ('images' | 'videos' | 'livePhotos')[];
    allowsEditing?: boolean;
    aspect?: [number, number];
    quality?: number;
  }) => Promise<ImagePickerResult>;
}

async function loadImagePicker(): Promise<ImagePickerModule | null> {
  try {
    // Dynamic import keeps expo-image-picker optional: the bundle/typecheck does
    // not hard-depend on it, and a missing native module degrades gracefully.
    const mod = (await import('expo-image-picker')) as unknown as {
      default?: ImagePickerModule;
    } & ImagePickerModule;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export default function AccountIdentityCard() {
  const t = useTokens();
  const styles = useStyles();
  const haptics = useHaptics();
  const reduceMotion = useReduceMotion();
  const { uploadAvatar, removeAvatar } = useAuth();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);

  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Transient confirmation after a successful change — a quiet "Saved" beats a
  // modal Alert for a low-stakes action the user can see worked.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    };
  }, []);

  const avatarUrl = user?.avatarUrl;
  const displayName = user ? identityLabel(user) : 'Account';
  const emailVerified = !!user?.emailVerified;
  const hasEmail = !!user?.email;

  const flashSaved = () => {
    haptics.success();
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2200);
  };

  const pickAndUpload = async () => {
    setError(null);
    setSaved(false);
    const picker = await loadImagePicker();
    if (!picker) {
      const msg = 'Image picker is unavailable. Install expo-image-picker to change your avatar.';
      setError(msg);
      Alert.alert('Unavailable', msg);
      return;
    }

    try {
      const perm = await picker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setError('Photo library permission is required to choose an avatar.');
        return;
      }

      const result = await picker.launchImageLibraryAsync({
        // SDK 52+ replaced the removed MediaTypeOptions enum with a string array.
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset) return;
      setBusy('upload');
      await uploadAvatar({
        uri: asset.uri,
        name: asset.fileName ?? 'avatar.jpg',
        type: asset.mimeType ?? 'image/jpeg',
        size: asset.fileSize ?? null,
      });
      flashSaved();
    } catch (err) {
      haptics.warning();
      setError(mapErrorToUserMessage(err, AVATAR_COPY.uploadFailed));
    } finally {
      setBusy(null);
    }
  };

  const confirmRemove = () => {
    Alert.alert(AVATAR_COPY.removeConfirmTitle, AVATAR_COPY.removeConfirmBody, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: AVATAR_COPY.remove,
        style: 'destructive',
        onPress: () => void handleRemove(),
      },
    ]);
  };

  const handleRemove = async () => {
    setError(null);
    setSaved(false);
    setBusy('remove');
    try {
      await removeAvatar();
      flashSaved();
    } catch (err) {
      haptics.warning();
      setError(mapErrorToUserMessage(err, AVATAR_COPY.removeFailed));
    } finally {
      setBusy(null);
    }
  };

  const hint =
    busy === 'upload' ? AVATAR_COPY.uploading : busy === 'remove' ? AVATAR_COPY.removing : AVATAR_COPY.rules;

  const Container = reduceMotion ? View : Animated.View;

  return (
    <Container entering={reduceMotion ? undefined : FadeInDown.duration(260)} style={styles.identity}>
      <TouchableOpacity
        onPress={() => void pickAndUpload()}
        disabled={busy !== null}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={avatarUrl ? AVATAR_COPY.change : AVATAR_COPY.add}
        accessibilityState={{ disabled: busy !== null }}
        style={styles.avatarTap}
      >
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={styles.avatar}
            accessibilityIgnoresInvertColors
            accessibilityLabel={`${displayName} avatar`}
          />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitials} maxFontSizeMultiplier={MAX_FONT_SCALE}>
              {displayInitials(user)}
            </Text>
          </View>
        )}
        {/* Camera affordance badge so it reads as tappable. */}
        <View style={styles.camBadge}>
          <Ionicons name="camera" size={12} color={t.colors.text.onLightAccent} />
        </View>
      </TouchableOpacity>

      <View
        style={styles.identityText}
        accessible
        accessibilityRole="summary"
        accessibilityLabel={`Signed in as ${displayName}${user?.username ? `, at ${user.username}` : ''}${
          hasEmail ? `, email ${emailVerified ? 'verified' : 'not verified'}` : ''
        }`}
      >
        <Text style={styles.name} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {displayName}
        </Text>
        {user?.username ? (
          <Text style={styles.handle} numberOfLines={1}>
            @{user.username}
          </Text>
        ) : null}
        {hasEmail ? (
          <View style={styles.identityMeta}>
            {/* Sacrificial NBSP absorbs Android's final-glyph under-measurement
                without rendering the visible punctuation used by the old sentinel. */}
            <Text style={styles.email} numberOfLines={2}>
              {`${user?.email} `}
            </Text>
          </View>
        ) : null}
        <View style={styles.chips}>
          {hasEmail ? (
            <View
              style={[styles.chip, emailVerified ? styles.chipVerified : styles.chipUnverified]}
              accessibilityRole="text"
              accessibilityLabel={emailVerified ? 'Email verified' : 'Email not verified'}
            >
              <Ionicons
                name={emailVerified ? 'checkmark-circle' : 'alert-circle'}
                size={12}
                color={emailVerified ? t.colors.status.verified : t.colors.accent.amber}
                style={styles.chipIcon}
              />
              <Text
                style={[styles.chipText, emailVerified ? styles.chipTextVerified : styles.chipTextUnverified]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                numberOfLines={1}
              >
                {emailVerified ? ACCOUNT_COPY.verified : ACCOUNT_COPY.unverified}
              </Text>
            </View>
          ) : null}
          {isAdmin ? (
            <View style={[styles.chip, styles.chipAdmin]} accessibilityRole="text" accessibilityLabel="Administrator">
              <Ionicons name="shield-half" size={12} color={t.colors.accent.aqua} style={styles.chipIcon} />
              <Text style={[styles.chipText, styles.chipTextAdmin]} maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={1}>
                Admin
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.photoLine}>
          {saved ? (
            <View style={styles.savedRow} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={13} color={t.colors.status.verified} style={styles.savedIcon} />
              <Text style={styles.savedText}>Saved</Text>
            </View>
          ) : (
            <Text style={styles.hint} accessibilityLiveRegion="polite">
              {hint}
            </Text>
          )}
        </View>
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {avatarUrl ? (
          <TouchableOpacity
            onPress={confirmRemove}
            disabled={busy !== null}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={AVATAR_COPY.remove}
            accessibilityState={{ disabled: busy !== null }}
            style={styles.removeBtn}
          >
            <Text style={styles.removeText}>{`${AVATAR_COPY.remove} `}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </Container>
  );
}

const useStyles = makeStyles((t) => ({
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[4],
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
  },
  avatarTap: {
    width: 64,
    height: 64,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: t.colors.bg.primary,
  },
  avatarInitials: {
    ...typeStyle('title'),
    color: t.colors.accent.aqua,
  },
  avatarFallback: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  camBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: t.colors.bg.secondary,
  },
  identityText: {
    flex: 1,
    gap: t.spacing[1],
  },
  name: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  handle: {
    ...typeStyle('body'),
    color: t.colors.accent.aqua,
  },
  identityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  email: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    marginTop: t.spacing[1],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: t.spacing[2],
    paddingVertical: 3,
    borderRadius: t.radii.pill,
    borderWidth: 1,
  },
  chipIcon: {
    marginRight: 4,
  },
  chipText: {
    ...typeStyle('micro'),
  },
  chipVerified: {
    backgroundColor: t.colors.status.verifiedBg,
    borderColor: t.colors.status.verifiedBg,
  },
  chipTextVerified: {
    color: t.colors.status.verified,
  },
  chipUnverified: {
    backgroundColor: t.colors.amberAlpha[12],
    borderColor: t.colors.amberAlpha[20],
  },
  chipTextUnverified: {
    color: t.colors.accent.amber,
  },
  chipAdmin: {
    backgroundColor: t.colors.aquaAlpha[10],
    borderColor: t.colors.aquaAlpha[20],
  },
  chipTextAdmin: {
    color: t.colors.accent.aqua,
  },
  photoLine: {
    marginTop: t.spacing[1],
  },
  hint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  savedIcon: {
    marginRight: 4,
  },
  savedText: {
    ...typeStyle('caption'),
    color: t.colors.status.verified,
  },
  error: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  removeBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  removeText: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
}));
