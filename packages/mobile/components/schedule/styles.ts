import { elevation } from '@festie/shared/tokens';
import { makeStyles, typeStyle } from '../../hooks/useTokens';

export const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
    // Clip to the screen frame. The schedule body's internal scroll views can
    // size to tall content; without this, on short screens (or large iOS notch
    // insets) that content overflows the frame's bottom edge and — because RN's
    // default overflow is 'visible' — paints AND intercepts touches over the
    // bottom tab bar, making tabs untappable. Clipping confines it to the body.
    overflow: 'hidden',
  },
  // DC1 — one horizontal control row: LiveDot · view switcher (flex) ·
  // search/filter toggles. Replaces the former two-line live row + switcher.
  // gap[1] (4px) instead of gap[2] (8px) recovers ~12px so both "Timeline" and
  // "Cards" labels fit without clipping on ~360dp phones (toggle targets are 44px
  // so they still comfortably meet WCAG 2.5.5 without the extra gap).
  viewSwitcher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  // minWidth:0 prevents the flex child from overflowing its flex allocation when
  // the SegmentedControl's natural content width exceeds the available space.
  switcherFlex: {
    flex: 1,
    minWidth: 0,
  },
  // DC1 (Option C) — Switch / Now&Next moved into ScreenHeader's trailing slot.
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
  },
  headerIconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target.
    minWidth: 44,
    minHeight: 44,
  },
  headerNowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: 22,
  },
  headerNowText: {
    ...typeStyle('label', 700),
    color: t.colors.accent.aqua,
  },
  pickerOffline: {
    ...typeStyle('label'),
    color: t.colors.accent.amber,
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[2],
  },
  toggleButton: {
    alignItems: 'center',
    justifyContent: 'center',
    // WCAG 2.5.5 / 2.5.8 minimum 44px touch target.
    minWidth: 44,
    minHeight: 44,
    borderRadius: t.radii.default,
  },
  toggleButtonActive: {
    backgroundColor: t.colors.aquaAlpha[12],
  },
  // Active-filter affordance: a small aqua dot on the filter toggle so a
  // collapsed-but-active filter stays discoverable.
  toggleDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.colors.accent.aqua,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginHorizontal: t.spacing[4],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    // border.light (0.10 alpha) instead of border.default (0.06) so the field
    // reads as an interactive text input and is not confused with the card
    // surfaces (same #1a1a1a bg) that lack a distinguishing border.
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  searchIcon: {
    marginRight: 0,
  },
  searchInput: {
    flex: 1,
    ...typeStyle('body'),
    color: t.colors.text.primary,
    padding: 0,
  },
  freshnessRow: {
    paddingTop: t.spacing[2],
  },
  compactRefreshButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
  },
  // Scroll-to-top FAB (cards view, long lineups). Aqua pill with dark ink to
  // match the timeline's Now FAB; sits above the tab bar, right-aligned.
  scrollTopFab: {
    position: 'absolute',
    bottom: t.spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    minHeight: 44,
    // Lift the pill above the surface so it reads as floating over the list.
    ...elevation.low,
  },
  scrollTopText: {
    ...typeStyle('label', 700),
    color: t.colors.text.onLightAccent,
  },
  zoneLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    marginTop: t.spacing[1],
  },
  filterRow: {
    paddingBottom: t.spacing[2],
  },
  filterContent: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[3],
    // WCAG 2.5.5 / 2.5.8 minimum 44x44px touch target (motor accessibility).
    minHeight: 44,
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  // R3 outlined-secondary variant for the "My picks" chip. The SegmentedControl
  // already holds the solid-aqua primary fill; a second solid aqua fill (the
  // old filterChipActive) violates the single-accent-fill-per-screen rule.
  // Outlined tint (aqua border + tinted bg, no solid fill) is the correct
  // secondary treatment for a non-primary toggle alongside a primary control.
  filterChipActiveTinted: {
    backgroundColor: t.colors.aquaAlpha[12],
    borderColor: t.colors.aquaAlpha[70],
  },
  // Inert "Pick a set first" chip: recessed background + lighter border, with a
  // muted label, so it reads as unavailable without relying on opacity.
  filterChipMuted: {
    backgroundColor: t.colors.bg.primary,
    borderColor: t.colors.border.light,
  },
  filterChipText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  // Companion text style for the outlined-tinted chip variant (My picks).
  filterChipTextTinted: {
    color: t.colors.accent.aqua,
  },
  filterChipTextMuted: {
    color: t.colors.text.muted,
  },
  daysGoingLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    paddingTop: t.spacing[2],
  },
  genreGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  stageDotSmall: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingTop: t.spacing[2],
    paddingBottom: t.spacing[1],
  },
  stageDot: {
    width: 10,
    height: 10,
    borderRadius: t.radii.pill,
  },
  earlierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  earlierText: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  stageHeaderText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
  },
  groupByRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingTop: t.spacing[2],
  },
  groupByLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  listContent: {
    padding: t.spacing[4],
    paddingTop: t.spacing[2],
    flexGrow: 1,
  },
  separator: {
    height: t.spacing[3],
  },
  // flex:1 binds the cards FlatList / fallback ScrollView to the (overflow-clipped)
  // container so they scroll internally up to the tab bar instead of sizing to
  // content and being clipped.
  scrollBody: {
    flex: 1,
  },
  timelineBody: {
    // A fixed height, not flex: inside a ScrollView flex:1 resolves to 0.
    overflow: 'hidden',
  },
  fallbackScroll: {
    flexGrow: 1,
    paddingBottom: t.spacing[4],
  },
  // ── Cold-load skeleton (geometry shared with the Picks tab) ───────────────
  skeletonContent: {
    paddingTop: t.spacing[2],
  },
  skeletonDay: {
    marginTop: t.spacing[4],
    marginBottom: t.spacing[3],
  },
  skeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    padding: t.spacing[4],
    minHeight: 72,
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
  },
  skeletonCardMain: {
    flex: 1,
    gap: t.spacing[2],
  },
}));
