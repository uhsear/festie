import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFestivalStore } from '@festie/shared/stores';
import {
  formatInviteExpiry,
  crewCopy,
  memberAvatarUrl,
  FESTIE_ORIGIN,
  memberIsOwner,
} from '@festie/shared/utils';
import type { Crew, CrewMember, Festival, User } from '@festie/shared/types';
import { useTokens, useLargeText, MAX_FONT_SCALE } from '../../hooks/useTokens';
import Button from '../Button';
import Avatar from '../Avatar';
import EmptyState from '../EmptyState';
import SectionLabel from '../SectionLabel';
import CrewMyDays from '../CrewMyDays';
import CrewLockRow from '../CrewLockRow';
import MemberDayChips from '../MemberDayChips';
import type { Dispatch, ReactElement, ReactNode, SetStateAction } from 'react';
import { useStyles } from './styles';

interface CrewMembersTabProps {
  crew: Crew;
  crewFestival: Festival | null | undefined;
  crewRefreshControl: ReactElement;
  editTotemEmoji: string;
  editTotemName: string;
  festivalDays: ReturnType<typeof useFestivalStore.getState>['days'];
  forceAddBusy: boolean;
  forceAddName: string;
  forceAddOpen: boolean;
  handleDelete: (crewId: string, crewName: string, memberCount: number) => void;
  handleForceAdd: (crewId: string) => Promise<void>;
  handleKick: (crewId: string, member: CrewMember) => void;
  handleLeave: (crewId: string) => void;
  handleOwnerLeave: (crewId: string, crewName: string, members: CrewMember[], selfId: string) => void;
  handleReform: (sourceCrewId: string, sourceFestivalId: string | undefined) => void;
  handleRegenerate: (crewId: string) => void;
  handleSaveRename: (crewId: string) => Promise<void>;
  handleSaveTotem: (crewId: string) => Promise<void>;
  handleShareInvite: (code: string, crewName: string) => void;
  handleTransfer: (crewId: string, member: CrewMember) => void;
  inviteCard: ReactNode;
  inviteExpiry: ReturnType<typeof formatInviteExpiry>;
  isOwner: boolean;
  managingMemberId: string | null;
  memberListStyle: StyleProp<ViewStyle>;
  members: CrewMember[];
  openTotemEditor: (c: Crew) => void;
  reformBusy: boolean;
  regenBusy: boolean;
  renameBusy: boolean;
  renameOpen: boolean;
  renameText: string;
  setEditTotemEmoji: Dispatch<SetStateAction<string>>;
  setEditTotemName: Dispatch<SetStateAction<string>>;
  setForceAddName: Dispatch<SetStateAction<string>>;
  setForceAddOpen: Dispatch<SetStateAction<boolean>>;
  setInviteQrOpen: Dispatch<SetStateAction<boolean>>;
  setManagingMemberId: Dispatch<SetStateAction<string | null>>;
  setRenameOpen: Dispatch<SetStateAction<boolean>>;
  setRenameText: Dispatch<SetStateAction<string>>;
  setTotemEditOpen: Dispatch<SetStateAction<boolean>>;
  tabBodyStyle: StyleProp<ViewStyle>;
  totemBusy: boolean;
  totemEditOpen: boolean;
  user: User;
}

export default function CrewMembersTab({
  crew,
  crewFestival,
  crewRefreshControl,
  editTotemEmoji,
  editTotemName,
  festivalDays,
  forceAddBusy,
  forceAddName,
  forceAddOpen,
  handleDelete,
  handleForceAdd,
  handleKick,
  handleLeave,
  handleOwnerLeave,
  handleReform,
  handleRegenerate,
  handleSaveRename,
  handleSaveTotem,
  handleShareInvite,
  handleTransfer,
  inviteCard,
  inviteExpiry,
  isOwner,
  managingMemberId,
  memberListStyle,
  members,
  openTotemEditor,
  reformBusy,
  regenBusy,
  renameBusy,
  renameOpen,
  renameText,
  setEditTotemEmoji,
  setEditTotemName,
  setForceAddName,
  setForceAddOpen,
  setInviteQrOpen,
  setManagingMemberId,
  setRenameOpen,
  setRenameText,
  setTotemEditOpen,
  tabBodyStyle,
  totemBusy,
  totemEditOpen,
  user,
}: CrewMembersTabProps) {
  const styles = useStyles();
  const t = useTokens();
  const largeText = useLargeText();
  return (
    <FlatList
      style={tabBodyStyle}
      data={members}
      extraData={managingMemberId}
      keyExtractor={(m) => m.userId}
      contentContainerStyle={memberListStyle}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      refreshControl={crewRefreshControl}
      renderItem={({ item }) => {
        const rowIsOwner = memberIsOwner(item, crew.owner);
        const displayName = item.name || 'Member';
        const isSelf = item.userId === user.id;
        // Owners may manage other members (kick + transfer). Force-add and
        // these controls hit admin-gated shared store actions.
        const canManage = isOwner && !rowIsOwner && !isSelf;
        const managing = managingMemberId === item.userId;
        return (
          <View>
            <View style={[styles.memberRow, largeText && styles.memberRowWrap]}>
              <Avatar name={displayName} image={memberAvatarUrl(item, FESTIE_ORIGIN)} size="md" />
              <View style={styles.memberInfo}>
                <Text style={styles.memberName} numberOfLines={2}>
                  {displayName}
                  {isSelf ? ' (you)' : ''}
                </Text>
                {rowIsOwner ? <Text style={styles.memberRole}>Owner</Text> : null}
                {crewFestival ? <MemberDayChips userId={item.userId} name={displayName} days={festivalDays} /> : null}
              </View>
              {canManage ? (
                <TouchableOpacity
                  onPress={() => setManagingMemberId(managing ? null : item.userId)}
                  style={styles.manageButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Manage ${displayName}`}
                  accessibilityState={{ expanded: managing }}
                >
                  <Text style={styles.manageButtonText} maxFontSizeMultiplier={MAX_FONT_SCALE}>Manage</Text>
                  <Ionicons name={managing ? 'chevron-up' : 'chevron-down'} size={16} color={t.colors.accent.aqua} />
                </TouchableOpacity>
              ) : rowIsOwner ? (
                <View accessible accessibilityLabel="Owner">
                  <Ionicons name="star" size={16} color={t.colors.aquaAlpha[40]} />
                </View>
              ) : null}
            </View>
            {canManage && managing ? (
              <View style={styles.memberActionRow}>
                <Button variant="secondary" size="sm" label="Make owner" onPress={() => handleTransfer(crew.id, item)} />
                <Button variant="danger" size="sm" label="Remove from crew" onPress={() => handleKick(crew.id, item)} />
              </View>
            ) : null}
          </View>
        );
      }}
      ListHeaderComponent={
        <View style={styles.membersHeader}>
          {inviteCard ? <View style={styles.inviteCardSpacer}>{inviteCard}</View> : null}
          {crew.inviteCode ? (
            <View style={styles.inviteBar}>
              <Ionicons name="key-outline" size={16} color={t.colors.accent.aqua} />
              <Text style={styles.inviteLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>Invite code</Text>
              <Text style={styles.inviteCode} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityLabel={`Invite code ${crew.inviteCode}`}>
                {crew.inviteCode}
              </Text>
              {inviteExpiry ? (
                <Text style={styles.inviteExpiry} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {inviteExpiry === 'Expired' && !isOwner
                    ? 'Expired. Ask the crew owner for a new link.'
                    : inviteExpiry}
                </Text>
              ) : null}
              <View style={[styles.inviteActions, largeText && styles.inviteActionsWrap]}>
                <TouchableOpacity
                  testID="crew-action-share-invite"
                  onPress={() => handleShareInvite(crew.inviteCode!, crew.name)}
                  style={styles.inviteActionButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Share invite link"
                >
                  <Ionicons name="share-outline" size={16} color={t.colors.accent.aqua} />
                  <Text style={styles.inviteActionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="crew-action-show-invite-qr"
                  onPress={() => setInviteQrOpen(true)}
                  style={styles.inviteActionButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Show QR code"
                >
                  <Ionicons name="qr-code-outline" size={16} color={t.colors.accent.aqua} />
                  <Text style={styles.inviteActionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>QR code</Text>
                </TouchableOpacity>
                {isOwner ? (
                  <TouchableOpacity
                    testID="crew-action-regenerate-invite"
                    onPress={() => handleRegenerate(crew.id)}
                    disabled={regenBusy}
                    style={styles.inviteActionButton}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel="Regenerate invite code"
                  >
                    {regenBusy ? (
                      <ActivityIndicator size="small" color={t.colors.accent.aqua} />
                    ) : (
                      <Ionicons name="refresh" size={16} color={t.colors.accent.aqua} />
                    )}
                    <Text style={styles.inviteActionLabel} maxFontSizeMultiplier={MAX_FONT_SCALE}>New code</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              {crew.maxMembers && members.length >= crew.maxMembers ? (
                <Text style={styles.inviteExpiry} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {crewCopy.inviteCrewFull(isOwner)}
                </Text>
              ) : null}
              <CrewLockRow crewId={crew.id} isOwner={isOwner} />
            </View>
          ) : null}
          {crewFestival ? (
            <CrewMyDays crewId={crew.id} myUserId={user.id} days={festivalDays} />
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon="person-outline"
          title="No members yet"
          message="Share your invite code to bring friends in."
          action={
            crew.inviteCode
              ? { label: 'Share invite', onPress: () => handleShareInvite(crew.inviteCode!, crew.name) }
              : undefined
          }
        />
      }
      ListFooterComponent={
        <View style={styles.tabFooter}>
          <SectionLabel>Manage</SectionLabel>

          {/* Reform this crew for another festival (M3). */}
          <TouchableOpacity
            testID="crew-action-reform"
            style={styles.overlapToggle}
            onPress={() => handleReform(crew.id, crew.festivalId)}
            disabled={reformBusy}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Reform this crew for another festival"
          >
            <Ionicons name="calendar-outline" size={16} color={t.colors.accent.aqua} />
            <Text style={styles.overlapToggleText}>
              {reformBusy ? 'Reforming…' : 'Reform for another festival'}
            </Text>
            {reformBusy ? (
              <ActivityIndicator size="small" color={t.colors.accent.aqua} />
            ) : (
              <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
            )}
          </TouchableOpacity>

          {/* Owner-only crew totem editor (rally marker: emoji + name). */}
          {isOwner ? (
            totemEditOpen ? (
              <View style={styles.forceAddBox}>
                <Text style={styles.formLabel}>Crew totem</Text>
                <View style={styles.totemFieldRow}>
                  <TextInput
                    style={[styles.input, styles.totemEmojiInput]}
                    placeholder="Emoji"
                    placeholderTextColor={t.colors.text.placeholder}
                    value={editTotemEmoji}
                    onChangeText={setEditTotemEmoji}
                    maxLength={16}
                    autoCorrect={false}
                    accessibilityLabel="Crew totem emoji"
                  />
                  <TextInput
                    style={[styles.input, styles.totemNameInput]}
                    placeholder="Totem name"
                    placeholderTextColor={t.colors.text.placeholder}
                    value={editTotemName}
                    onChangeText={setEditTotemName}
                    maxLength={40}
                    returnKeyType="done"
                    onSubmitEditing={() => handleSaveTotem(crew.id)}
                    accessibilityLabel="Crew totem name"
                  />
                </View>
                <View style={styles.forceAddRow}>
                  <TouchableOpacity
                    style={[styles.outlineButton, styles.flexButton]}
                    onPress={() => setTotemEditOpen(false)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel totem edit"
                  >
                    <Text style={styles.outlineButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <Button
                    label={totemBusy ? 'Saving…' : 'Save totem'}
                    onPress={() => handleSaveTotem(crew.id)}
                    disabled={totemBusy}
                    accessibilityLabel="Save crew totem"
                    style={styles.flexButton}
                  />
                </View>
              </View>
            ) : (
              <TouchableOpacity
                testID="crew-action-edit-totem"
                style={styles.overlapToggle}
                onPress={() => openTotemEditor(crew)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Edit crew totem"
              >
                <Ionicons name="flag-outline" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.overlapToggleText}>
                  {crew.totem_emoji || crew.totem_name ? 'Edit crew totem' : crewCopy.addTotem}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
              </TouchableOpacity>
            )
          ) : null}
          {isOwner && !totemEditOpen ? <Text style={styles.formHint}>{crewCopy.totemExplainer}</Text> : null}

          {/* Rename (owner). */}
          {isOwner ? (
            renameOpen ? (
              <View style={styles.forceAddBox}>
                <Text style={styles.formLabel}>Crew name</Text>
                <TextInput
                  style={styles.input}
                  value={renameText}
                  onChangeText={setRenameText}
                  maxLength={60}
                  returnKeyType="done"
                  onSubmitEditing={() => handleSaveRename(crew.id)}
                  accessibilityLabel="Crew name"
                />
                <View style={styles.forceAddRow}>
                  <TouchableOpacity
                    style={[styles.outlineButton, styles.flexButton]}
                    onPress={() => setRenameOpen(false)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel rename"
                  >
                    <Text style={styles.outlineButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <Button
                    label={renameBusy ? 'Saving…' : 'Save'}
                    onPress={() => handleSaveRename(crew.id)}
                    disabled={renameBusy || !renameText.trim() || renameText.trim() === crew.name}
                    accessibilityLabel="Save crew name"
                    style={styles.flexButton}
                  />
                </View>
              </View>
            ) : (
              <TouchableOpacity
                testID="crew-action-rename"
                style={styles.overlapToggle}
                onPress={() => {
                  setRenameText(crew.name);
                  setRenameOpen(true);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Rename crew"
              >
                <Ionicons name="pencil-outline" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.overlapToggleText}>Rename crew</Text>
                <Ionicons name="chevron-forward" size={16} color={t.colors.accent.aqua} />
              </TouchableOpacity>
            )
          ) : null}

          {/* Force-add by username (admin-gated server-side). Shown to admins only. */}
          {user.isAdmin ? (
            forceAddOpen ? (
              <View style={styles.forceAddBox}>
                <Text style={styles.formLabel}>Username</Text>
                <TextInput
                  style={styles.input}
                  placeholder="username"
                  placeholderTextColor={t.colors.text.placeholder}
                  value={forceAddName}
                  onChangeText={setForceAddName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => handleForceAdd(crew.id)}
                  accessibilityLabel="Username to add"
                />
                <View style={styles.forceAddRow}>
                  <TouchableOpacity
                    style={[styles.outlineButton, styles.flexButton]}
                    onPress={() => {
                      setForceAddOpen(false);
                      setForceAddName('');
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel force-add"
                  >
                    <Text style={styles.outlineButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <Button
                    label={forceAddBusy ? 'Adding…' : 'Add'}
                    onPress={() => handleForceAdd(crew.id)}
                    disabled={forceAddBusy || !forceAddName.trim()}
                    accessibilityLabel="Confirm force-add"
                    style={styles.flexButton}
                  />
                </View>
              </View>
            ) : (
              <TouchableOpacity
                testID="crew-action-force-add"
                style={styles.overlapToggle}
                onPress={() => setForceAddOpen(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Add member by username (admin)"
              >
                <Ionicons name="person-add-outline" size={16} color={t.colors.accent.aqua} />
                <Text style={styles.overlapToggleText}>Add member by username (admin)</Text>
              </TouchableOpacity>
            )
          ) : null}

          <View style={styles.footerActions}>
            <TouchableOpacity
              testID="crew-action-leave"
              style={styles.dangerButton}
              onPress={() =>
                isOwner ? handleOwnerLeave(crew.id, crew.name, members, user.id) : handleLeave(crew.id)
              }
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Leave crew"
            >
              <Ionicons name="exit-outline" size={16} color={t.colors.text.danger} />
              <Text style={styles.dangerButtonText}>Leave crew</Text>
            </TouchableOpacity>
          </View>
          {isOwner ? (
            <View style={styles.footerActions}>
              <TouchableOpacity
                testID="crew-action-delete"
                style={styles.dangerButton}
                onPress={() => handleDelete(crew.id, crew.name, members.length)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Delete crew"
              >
                <Ionicons name="trash-outline" size={16} color={t.colors.text.danger} />
                <Text style={styles.dangerButtonText}>Delete crew</Text>
              </TouchableOpacity>
              <Text style={styles.formHint}>Deletes the crew for everyone.</Text>
            </View>
          ) : null}
        </View>
      }
    />
  );
}
