import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GHOST_ROWS, resolveGhostToken, type GhostRow as GhostRowModel, type GhostRowKind } from '@festie/shared/constants/ghostRows';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';

const GLYPH: Record<GhostRowModel['glyph'], keyof typeof Ionicons.glyphMap> = {
  music: 'musical-notes-outline',
  person: 'person-outline',
  bell: 'notifications-outline',
};

/** A dashed, decorative example row for an empty state. The row model lives in `@festie/shared`. */
export default function GhostRow({ kind }: { kind: GhostRowKind }) {
  const row = GHOST_ROWS[kind];
  const styles = useStyles();
  const t = useTokens();
  const border = resolveGhostToken(t.colors, row.tokens.border);
  const ink = resolveGhostToken(t.colors, row.tokens.text);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="ghost-row"
      style={[styles.row, { borderColor: border }]}
    >
      <Ionicons name={GLYPH[row.glyph]} size={t.iconSize.md} color={resolveGhostToken(t.colors, row.tokens.glyph)} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: ink }]} numberOfLines={1}>{row.title}</Text>
        <Text style={[styles.detail, { color: ink }]} numberOfLines={1}>{row.detail}</Text>
      </View>
      {row.pills.map((label) => (
        <Text key={label} style={[styles.pill, { color: ink, borderColor: border }]}>{label}</Text>
      ))}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    alignSelf: 'stretch',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: t.radii.default,
    padding: t.spacing[3],
  },
  text: { flex: 1, minWidth: 0 },
  title: typeStyle('label'),
  detail: typeStyle('caption'),
  pill: {
    ...typeStyle('caption'),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: t.radii.pill,
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
  },
}));
