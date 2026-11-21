import { useState } from 'react';
import { TextInput } from 'react-native';
import { useTokens } from '../../../hooks/useTokens';
import { useStyles } from './styles';

/** Name field with a local draft so a trimmed commit never eats a typed space. Commits on every change: Save does not blur the field, so an end-editing commit would be lost. */
export default function NameInput({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const t = useTokens();
  const styles = useStyles();
  const [draft, setDraft] = useState(value);
  return (
    <TextInput
      style={styles.nameInput}
      value={draft}
      onChangeText={(v) => {
        setDraft(v);
        onCommit(v);
      }}
      placeholderTextColor={t.colors.text.placeholder}
      placeholder="Unnamed"
      autoCorrect={false}
      accessibilityLabel={`Name of ${label}`}
    />
  );
}
