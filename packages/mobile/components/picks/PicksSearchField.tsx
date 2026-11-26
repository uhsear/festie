import { View, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTokens } from '../../hooks/useTokens';
import { useStyles } from './styles';

interface PicksSearchFieldProps {
  search: string;
  setSearch: (q: string) => void;
}

export default function PicksSearchField({
  search,
  setSearch,
}: PicksSearchFieldProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
<View style={styles.searchRow}>
  <Ionicons name="search" size={t.iconSize.sm} color={t.colors.text.placeholder} />
  <TextInput
    style={styles.searchInput}
    value={search}
    onChangeText={setSearch}
    placeholder="Filter picks by artist or stage"
    placeholderTextColor={t.colors.text.placeholder}
    autoCapitalize="none"
    autoCorrect={false}
    autoFocus={search.length === 0}
    returnKeyType="search"
    accessibilityLabel="Filter my picks"
  />
  {search.length > 0 ? (
    <TouchableOpacity
      style={styles.clearSearchButton}
      onPress={() => setSearch('')}
      accessibilityRole="button"
      accessibilityLabel="Clear search"
    >
      <Ionicons name="close-circle" size={t.iconSize.action} color={t.colors.text.muted} />
    </TouchableOpacity>
  ) : null}
</View>
  );
}
