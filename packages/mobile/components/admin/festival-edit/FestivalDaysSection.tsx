import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type SetEngagementMap } from '@festie/shared/services';
import SectionLabel from '../../SectionLabel';
import {
  LabeledTextInput,
  ModalSelect,
  DateField,
  TimeField,
  type SelectOption,
} from '..';
import { useTokens } from '../../../hooks/useTokens';
import { type SetRow, type FormState } from '../../../app/admin/festivalEditState';
import { filterLineup, setEngagementLabel, startsAfterMidnight } from '@festie/shared/utils';
import type { Dispatch, ReactElement, SetStateAction } from 'react';
import { useStyles } from './styles';

interface FestivalDaysSectionProps {
  addDay: () => void;
  addSet: (dayId: string) => void;
  artistInputs: (dayId: string, s: SetRow, artistError: string | null) => ReactElement;
  changes: { total: number; changedSetIds: Set<string>; newSetIds: Set<string>; };
  engagement: SetEngagementMap | null;
  engagementError: boolean;
  expandedDays: Set<string>;
  fieldIssuesOf: (keys: string[], fields: string[]) => string | null;
  filter: string;
  form: FormState;
  issuesByKey: Map<string, string[]>;
  removeDay: (dayId: string) => void;
  removeSet: (dayId: string, setId: string) => void;
  setDayField: (dayId: string, field: "label" | "date", value: string) => void;
  setFilter: Dispatch<SetStateAction<string>>;
  setKeys: (s: SetRow, dayIndex: number, setIndex: number) => string[];
  setSetField: (dayId: string, setId: string, field: keyof SetRow, value: string) => void;
  setShiftDayId: Dispatch<SetStateAction<string | null>>;
  stageOptions: SelectOption[];
  toggleDay: (dayId: string) => void;
}

export default function FestivalDaysSection({
  addDay,
  addSet,
  artistInputs,
  changes,
  engagement,
  engagementError,
  expandedDays,
  fieldIssuesOf,
  filter,
  form,
  issuesByKey,
  removeDay,
  removeSet,
  setDayField,
  setFilter,
  setKeys,
  setSetField,
  setShiftDayId,
  stageOptions,
  toggleDay,
}: FestivalDaysSectionProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <>
      <SectionLabel>Days &amp; artists</SectionLabel>
      <View style={styles.card}>
        {engagementError ? <Text style={styles.emptyHint}>Couldn't load pick counts.</Text> : null}
        <LabeledTextInput
          label="Filter"
          value={filter}
          onChangeText={setFilter}
          placeholder="Artist or stage"
          autoCapitalize="none"
        />
        {form.days.length === 0 ? (
          <Text style={styles.emptyHint}>No days yet. Add one below.</Text>
        ) : (
          form.days.map((day, dayIndex) => {
            const visibleSets = filterLineup(day.sets, form.stages, filter);
            const isExpanded = expandedDays.has(day.id) || (filter.trim() !== '' && visibleSets.length > 0);
            return (
              <View key={day.id} style={styles.dayBlock}>
                <View style={styles.dayHeader}>
                  <TouchableOpacity
                    onPress={() => toggleDay(day.id)}
                    style={styles.chevronBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={isExpanded ? 'Collapse day' : 'Expand day'}
                    accessibilityState={{ expanded: isExpanded }}
                  >
                    <Ionicons
                      name={isExpanded ? 'chevron-down' : 'chevron-forward'}
                      size={t.iconSize.md}
                      color={t.colors.text.secondary}
                    />
                  </TouchableOpacity>
                  <Text style={styles.dayTitle} numberOfLines={1}>
                    {day.label || 'Untitled day'}
                  </Text>
                  <Text style={styles.dayCount}>
                    {day.sets.length} {day.sets.length === 1 ? 'artist' : 'artists'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => removeDay(day.id)}
                    style={styles.removeBtn}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${day.label || 'day'}`}
                  >
                    <Ionicons name="trash-outline" size={t.iconSize.sm} color={t.colors.accent.coral} />
                  </TouchableOpacity>
                </View>

                {isExpanded ? (
                  <View style={styles.dayBody}>
                    <LabeledTextInput
                      label="Label"
                      value={day.label}
                      onChangeText={(v) => setDayField(day.id, 'label', v)}
                      placeholder="Day 1 / Friday"
                      autoCapitalize="words"
                    />
                    <DateField label="Date" value={day.date} onChangeText={(v) => setDayField(day.id, 'date', v)} />

                    {day.sets.length === 0 ? (
                      <Text style={styles.emptyHint}>No artists yet. Add one below.</Text>
                    ) : visibleSets.length === 0 ? (
                      <Text style={styles.emptyHint}>No sets match &quot;{filter.trim()}&quot;.</Text>
                    ) : (
                      visibleSets.map((s) => {
                        const keys = setKeys(s, dayIndex, day.sets.indexOf(s));
                        const isNew = changes.newSetIds.has(s.id);
                        const isChanged = changes.changedSetIds.has(s.id);
                        const stageError = fieldIssuesOf(keys, ['stageId']);
                        const timeError = fieldIssuesOf(keys, ['startTime', 'endTime']);
                        return (
                        <View
                          key={s.id}
                          style={[
                            styles.setBlock,
                            (isNew || isChanged) && styles.setBlockChanged,
                            keys.some((k) => issuesByKey.has(k)) && styles.blockError,
                          ]}
                        >
                          <View style={styles.setHeader}>
                            <Text style={styles.setHeaderText}>
                              Artist set
                              {isNew || isChanged ? (
                                <Text style={styles.changeCaption}>{isNew ? '  New' : '  Changed'}</Text>
                              ) : null}
                            </Text>
                            <TouchableOpacity
                              onPress={() => removeSet(day.id, s.id)}
                              style={styles.removeBtn}
                              activeOpacity={0.7}
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${s.artist || 'artist'}`}
                            >
                              <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
                            </TouchableOpacity>
                          </View>
                          {engagement ? (
                            <Text style={styles.emptyHint}>
                              {setEngagementLabel(engagement[s.id] ?? { picks: 0, reminders: 0 })}
                            </Text>
                          ) : null}
                          {artistInputs(day.id, s, fieldIssuesOf(keys, ['artist']))}
                          <ModalSelect
                            label="Stage"
                            value={s.stageId || null}
                            options={stageOptions}
                            onSelect={(v) => setSetField(day.id, s.id, 'stageId', v)}
                            placeholder="— Stage —"
                          />
                          {stageError ? (
                            <Text style={styles.fieldError} accessibilityLiveRegion="polite">
                              {stageError}
                            </Text>
                          ) : null}
                          <View style={styles.datePair}>
                            <View style={styles.flex}>
                              <TimeField
                                label="Start"
                                value={s.startTime}
                                onChangeText={(v) => setSetField(day.id, s.id, 'startTime', v)}
                                hint={
                                  startsAfterMidnight(s.startTime)
                                    ? `After midnight. Shows as part of ${day.label.trim() || "this day's"} night.`
                                    : undefined
                                }
                              />
                            </View>
                            <View style={styles.flex}>
                              <TimeField
                                label="End"
                                value={s.endTime}
                                onChangeText={(v) => setSetField(day.id, s.id, 'endTime', v)}
                              />
                            </View>
                          </View>
                          {timeError ? (
                            <Text style={styles.fieldError} accessibilityLiveRegion="polite">
                              {timeError}
                            </Text>
                          ) : null}
                        </View>
                        );
                      })
                    )}
                    <TouchableOpacity
                      onPress={() => setShiftDayId(day.id)}
                      style={styles.toolBtn}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Shift times for ${day.label || 'this day'}`}
                    >
                      <Ionicons name="time-outline" size={t.iconSize.md} color={t.colors.accent.aqua} />
                      <Text style={styles.toolBtnText}>Shift times</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => addSet(day.id)}
                      style={styles.addBtn}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Add artist"
                    >
                      <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
                      <Text style={styles.addBtnText}>Add artist</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
        <TouchableOpacity
          onPress={addDay}
          style={styles.addBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Add day"
        >
          <Ionicons name="add" size={t.iconSize.md} color={t.colors.accent.aqua} />
          <Text style={styles.addBtnText}>Add day</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}
