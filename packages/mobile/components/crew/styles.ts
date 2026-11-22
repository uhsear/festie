import { StyleSheet } from 'react-native';
import { makeStyles, typeStyle } from '../../hooks/useTokens';


export const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  // Bind each scroll body (Members FlatList + the Plan/Logistics/Money
  // ScrollViews + the no-crew form) to the screen's remaining height. Without
  // flex:1 they size to content, overflow past the bottom tab bar (member rows
  // "overlapping" the nav) and let the fixed chrome / CrewTabBar above expand to
  // fill the slack — which is why a tab's controls looked oversized on the
  // shorter Plan/Logistics panes. flex:1 makes the body absorb the slack and
  // scroll internally instead.
  flex1: {
    flex: 1,
  },
  formScroll: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[4],
  },
  // Persistent crew chrome (identity / invite / switcher) above the tab bar.
  crewChrome: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
    paddingBottom: t.spacing[2],
  },
  // Members-tab header: the invite bar (setup) moved out of the pinned chrome.
  membersHeader: {
    marginBottom: t.spacing[3],
  },
  inviteCardSpacer: {
    marginBottom: t.spacing[3],
  },
  // Header meta row: freshness badge + low-power indicator.
  crewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  // Compact always-visible SOS entry, right-aligned in the header meta row.
  // coralStrong bg + white text mirrors the Button danger pattern; jumps to the
  // Logistics tab where the full CrewSos panel renders.
  sosChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    marginLeft: 'auto',
    paddingHorizontal: t.spacing[3],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.coralStrong,
  },
  sosChipText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onAccent,
  },
  // Crew totem chip shown in the header (emoji + name rally marker).
  totemChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
  },
  totemChipEmoji: {
    ...typeStyle('label'),
  },
  totemChipName: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  // Totem create/edit fields: a narrow emoji box + a flexible name box.
  totemFieldRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  totemEmojiInput: {
    width: 64,
    textAlign: 'center',
  },
  totemNameInput: {
    flex: 1,
  },
  // Live-location block when low-power mode pauses the share.
  lowPowerPaused: {
    gap: t.spacing[2],
  },
  lowPowerPausedText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // Scroll content for the Plan / Logistics / Money tabs.
  tabScroll: {
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[1],
    gap: t.spacing[3],
  },
  // Members-tab footer (Manage cluster + danger actions).
  tabFooter: {
    gap: t.spacing[3],
    marginTop: t.spacing[4],
  },
  error: {
    ...typeStyle('body'),
    color: t.colors.text.danger,
    textAlign: 'center',
  },
  formGroup: {
    gap: t.spacing[2],
  },
  formLabel: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  formHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  input: {
    backgroundColor: t.colors.bg.input,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  // Primary aqua CTAs migrated to components/Button (F8).
  outlineButton: {
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    borderRadius: t.radii.default,
    paddingVertical: t.spacing[3],
    alignItems: 'center',
  },
  outlineButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  flexButton: {
    flex: 1,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  inviteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    rowGap: t.spacing[2],
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  inviteActions: {
    flexDirection: 'row',
    gap: t.spacing[2],
    width: '100%',
  },
  inviteActionsWrap: {
    flexWrap: 'wrap',
  },
  // Labelled, like the Find pane's invite buttons, so the icons are not a guessing game.
  inviteActionButton: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  inviteActionLabel: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  inviteLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  inviteExpiry: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  inviteCode: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    marginLeft: 'auto',
    letterSpacing: 2,
  },
  switcherButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  switcherButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  notice: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  inviteCard: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  inviteCardTitle: {
    ...typeStyle('label', 700),
    color: t.colors.text.primary,
  },
  inviteCardBody: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  overlapToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapToggleText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  overlapToggleLabelStack: {
    flex: 1,
    flexDirection: 'column',
    gap: 1,
  },
  overlapToggleHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Emphasized variant for the everyday-primary action (Crew plan): aqua-tinted
  // fill + aqua border so it carries more weight than the plain toolbox rows,
  // without becoming a loud solid-aqua CTA.
  overlapTogglePrimary: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  overlapTogglePrimaryText: {
    ...typeStyle('label', 700),
    color: t.colors.accent.aqua,
    flex: 1,
  },
  planIndexRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  planIndexChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapEmpty: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingHorizontal: t.spacing[2],
  },
  overlapErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.text.danger,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapErrorText: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    flex: 1,
  },
  overlapRetryText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  overlapList: {
    gap: t.spacing[2],
  },
  overlapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  overlapInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  overlapSet: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  overlapMeta: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  overlapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
  },
  overlapBadgeText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  forceAddBox: {
    gap: t.spacing[2],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  forceAddRow: {
    flexDirection: 'row',
    gap: t.spacing[2],
  },
  memberList: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[6],
    gap: t.spacing[3],
  },
  // Cold-start skeleton (mirrors the member-row geometry so nothing jumps).
  skeletonList: {
    gap: t.spacing[3],
    marginTop: t.spacing[3],
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    minHeight: 56,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  skeletonRowBody: {
    flex: 1,
    gap: t.spacing[2],
  },
  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  countBadge: {
    minWidth: 18,
    paddingHorizontal: t.spacing[1],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[15],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: t.spacing[1],
  },
  countBadgeText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  // "All packed" affordance — a calm aqua confirmation pill (not coral; this is
  // a positive done-state, not an alarm) shown when nothing is left to claim.
  donePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.aquaAlpha[12],
    marginBottom: t.spacing[1],
  },
  donePillText: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  unsettledDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.colors.accent.coral,
    marginBottom: t.spacing[1],
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    // Match AccountScreen's row floor so every member row keeps a >=44pt
    // touch target even when the name wraps to a single short line.
    minHeight: 56,
    // Hairline-divider idiom: flat row separated by a single-pixel bottom
    // border rather than individually boxed cards.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.colors.border.default,
  },
  memberRowWrap: {
    flexWrap: 'wrap',
  },
  memberInfo: {
    flex: 1,
    gap: t.spacing[1],
  },
  memberName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  memberRole: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  manageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
  },
  manageButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  memberActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingBottom: t.spacing[3],
  },
  liveSafetyBlock: {
    gap: t.spacing[3],
    marginBottom: t.spacing[2],
  },
  footerActions: {
    marginTop: t.spacing[4],
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.text.danger,
    backgroundColor: t.colors.bg.secondary,
  },
  dangerButtonText: {
    ...typeStyle('label'),
    color: t.colors.text.danger,
  },
}));
