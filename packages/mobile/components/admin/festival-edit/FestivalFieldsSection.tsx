import { View } from 'react-native';
import SectionLabel from '../../SectionLabel';
import { LabeledTextInput, ModalSelect, type SelectOption } from '..';
import { type FormState } from '../../../app/admin/festivalEditState';
import { useStyles } from './styles';

interface FestivalFieldsSectionProps {
  fieldIssues: (key: string, fields: string[]) => string | null;
  form: FormState;
  timeZoneOptions: SelectOption[];
  updateForm: (updater: (f: FormState) => FormState) => void;
}

export default function FestivalFieldsSection({
  fieldIssues,
  form,
  timeZoneOptions,
  updateForm,
}: FestivalFieldsSectionProps) {
  const styles = useStyles();
  return (
    <>
      <SectionLabel>Festival</SectionLabel>
      <View style={styles.card}>
        <LabeledTextInput
          label="Name"
          value={form.name}
          onChangeText={(v) => updateForm((f) => ({ ...f, name: v }))}
          placeholder="Festival name"
          autoCapitalize="words"
          error={fieldIssues('festival:name', ['name'])}
        />
        <LabeledTextInput
          label="Location"
          value={form.location}
          onChangeText={(v) => updateForm((f) => ({ ...f, location: v }))}
          placeholder="City, venue"
          autoCapitalize="words"
        />
        <ModalSelect
          label="Time zone"
          value={form.timeZone}
          options={timeZoneOptions}
          onSelect={(v) => updateForm((f) => ({ ...f, timeZone: v }))}
          placeholder="Choose a time zone…"
          searchable
          hint="Set times, countdowns and reminders use this zone."
        />
        <LabeledTextInput
          label="B2B separator"
          value={form.b2bSeparator}
          onChangeText={(v) => updateForm((f) => ({ ...f, b2bSeparator: v }))}
          placeholder="b2b"
          autoCapitalize="none"
          maxLength={10}
          hint="Joins B2B artist names, for example b2b, vs or &. Up to 10 characters."
        />
      </View>
    </>
  );
}
