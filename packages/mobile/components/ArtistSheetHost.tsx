import { useMemo } from 'react';
import { useSegments } from 'expo-router';
import { Linking, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFestivalDataStore } from '@festie/shared/stores';
import { useArtistSheetStore } from '@festie/shared/stores/artistSheetStore';
import { useInterest } from '@festie/shared/hooks/useInterest';
import { artistLinkEntries, spotifyAttributionFor } from '@festie/shared/utils';
import { enrichArtistTarget } from '@festie/shared/utils/artistSheet';
import { genreChipLabel } from '@festie/shared/constants';
import { makeStyles, typeStyle, MAX_FONT_SCALE } from '../hooks/useTokens';
import Avatar from './Avatar';
import SheetShell from './SheetShell';
import SpotifyAttribution from './SpotifyAttribution';

/** The filled or empty "Interested" toggle on one act. A guest's mark stays on the device. */
export function InterestToggle({ entryId, name }: { entryId: string; name: string }) {
  const styles = useStyles();
  const { marked, toggle } = useInterest(entryId);
  return (
    <TouchableOpacity
      style={[styles.interestToggle, marked && styles.interestToggleOn]}
      // toggleInterest rolls the mark back and sets the store error when the write fails, so the toggle already shows the truth.
      onPress={() => toggle().catch(() => {})}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: marked }}
      accessibilityLabel={`Interested in ${name}`}
    >
      <Text style={[styles.interestText, marked && styles.interestTextOn]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        Interested
      </Text>
    </TouchableOpacity>
  );
}

/**
 * The one artist sheet: each artist's photo, genres and links, plus the Interested toggle for an announced
 * act. Every artist name in the app opens it through useArtistSheetStore. The root layout mounts it for
 * ordinary screens. The set screen is a native form sheet, and iOS cannot present a second modal from the
 * root while that sheet is up, so the set screen mounts its own copy with `inSetSheet`. Only the copy that
 * matches the focused route shows.
 */
export default function ArtistSheetHost({ inSetSheet = false }: { inSetSheet?: boolean }) {
  const styles = useStyles();
  const target = useArtistSheetStore((s) => s.target);
  const isOpen = useArtistSheetStore((s) => s.isOpen);
  const close = useArtistSheetStore((s) => s.close);
  const sets = useFestivalDataStore((s) => s.sets);
  const onSetRoute = useSegments()[0] === 'set';
  const shown = useMemo(() => (target ? enrichArtistTarget(target, sets) : null), [target, sets]);
  return (
    <SheetShell visible={isOpen && shown !== null && onSetRoute === inSetSheet} onClose={close} backdropLabel="Close" maxHeight="85%">
      {shown ? (
        <>
          <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {shown.title}
          </Text>
          <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
            {shown.artists.map((artist, i) => (
              <View key={artist.id ?? `${artist.name}-${i}`} style={styles.artist}>
                <Avatar name={artist.name} image={artist.photo} size="md" />
                <View style={styles.artistBody}>
                  <Text style={styles.artistName} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {artist.name}
                  </Text>
                  {artist.genres?.length ? (
                    <Text style={styles.when} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                      {artist.genres.map(genreChipLabel).join(' · ')}
                    </Text>
                  ) : null}
                  {spotifyAttributionFor([artist]) ? <SpotifyAttribution href={spotifyAttributionFor([artist])!.href} /> : null}
                  <View style={styles.linkRow}>
                    {artistLinkEntries(artist.links).map((link) => (
                      <TouchableOpacity
                        key={link.key}
                        style={styles.linkButton}
                        onPress={() => Linking.openURL(link.url).catch(() => {})}
                        activeOpacity={0.7}
                        accessibilityRole="link"
                        accessibilityLabel={`${artist.name} on ${link.label}`}
                      >
                        <Text style={styles.linkText} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                          {link.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>
          {shown.entryId ? (
            <View style={styles.sheetFooter}>
              <InterestToggle entryId={shown.entryId} name={shown.title} />
            </View>
          ) : null}
        </>
      ) : null}
    </SheetShell>
  );
}

const useStyles = makeStyles((t) => ({
  title: { ...typeStyle('title'), color: t.colors.text.primary },
  when: { ...typeStyle('caption'), color: t.colors.text.secondary },
  interestToggle: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  interestToggleOn: { backgroundColor: t.colors.accent.aqua, borderColor: t.colors.accent.aqua },
  interestText: { ...typeStyle('caption', 600), color: t.colors.text.secondary },
  interestTextOn: { color: t.colors.text.onLightAccent },
  sheetList: { flexGrow: 0 },
  sheetListContent: { gap: t.spacing[4] },
  sheetFooter: { alignItems: 'flex-start' },
  artist: { flexDirection: 'row', gap: t.spacing[3], alignItems: 'flex-start' },
  artistBody: { flex: 1, gap: t.spacing[1] },
  artistName: { ...typeStyle('body', 600), color: t.colors.text.primary },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing[2] },
  linkButton: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  linkText: { ...typeStyle('label', 600), color: t.colors.text.primary },
}));
