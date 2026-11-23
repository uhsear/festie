import { makeStyles, typeStyle } from '../../hooks/useTokens';

export const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  body: {
    flex: 1,
  },
  listContent: {
    padding: t.spacing[4],
    paddingBottom: t.spacing[6],
  },
  headerActions: {
    flexDirection: 'row',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  offlineCard: {
    marginBottom: t.spacing[3],
  },
  calendarButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  calendarButtonText: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  // At large text the three actions wrap two per row instead of truncating their labels.
  headerActionsLarge: {
    flexWrap: 'wrap',
  },
  calendarButtonLarge: {
    flexBasis: 'auto',
    minWidth: '45%',
  },
  calendarButtonDisabled: {
    opacity: 0.5,
  },
  listenCard: {
    marginBottom: t.spacing[3],
    paddingHorizontal: t.spacing[3],
    paddingBottom: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  listenToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
  },
  listenTitle: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flex: 1,
  },
  listenDay: {
    marginBottom: t.spacing[2],
  },
  listenDayLabel: {
    ...typeStyle('caption', 700),
    color: t.colors.text.secondary,
  },
  listenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 44,
  },
  listenName: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  listenLinkHit: {
    minHeight: 44,
    justifyContent: 'center',
  },
  listenLink: {
    ...typeStyle('label'),
    color: t.colors.accent.aqua,
  },
  separator: {
    height: t.spacing[2],
  },
  // ── Inline all-days clash banner ──────────────────────────────────────────
  clashWrap: {
    marginBottom: t.spacing[2],
    gap: t.spacing[2],
  },
  clashHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  clashHeadingText: {
    ...typeStyle('label'),
    color: t.colors.accent.coral,
  },
  clashCard: {
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    borderLeftWidth: 4,
    backgroundColor: t.colors.bg.card,
    padding: t.spacing[3],
    gap: t.spacing[2],
  },
  clashCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: t.spacing[2],
  },
  clashCardTime: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  clashDecideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  clashDecideText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  clashActList: {
    gap: t.spacing[1],
  },
  clashActRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  clashPriorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  clashActName: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flexShrink: 1,
  },
  clashActNameKeep: {
    ...typeStyle('body', 700),
    color: t.colors.text.primary,
  },
  clashKeepTag: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
  },
  clashKeepTagText: {
    ...typeStyle('caption'),
    color: t.colors.accent.aqua,
  },
  // ── Summary / focus-filter chips ─────────────────────────────────────────
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  statChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.card,
    minHeight: 44,
  },
  statChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  statChipActiveDanger: {
    borderColor: t.colors.accent.coral,
    backgroundColor: t.colors.ring.coral,
  },
  statDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  statCount: {
    ...typeStyle('caption', 700),
    color: t.colors.text.primary,
  },
  // ── Organize controls (group toggle + search) ────────────────────────────
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginBottom: t.spacing[2],
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: t.spacing[1],
    padding: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[1],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.sm,
    minHeight: 44,
  },
  segmentBtnActive: {
    backgroundColor: t.colors.aquaAlpha[12],
  },
  segmentText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  segmentTextActive: {
    ...typeStyle('caption', 700),
    color: t.colors.accent.aqua,
  },
  iconControl: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.secondary,
  },
  iconControlActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.aquaAlpha[10],
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.secondary,
  },
  searchInput: {
    flex: 1,
    ...typeStyle('body'),
    color: t.colors.text.primary,
    padding: 0,
  },
  clearSearchButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ── Cold-load skeleton ────────────────────────────────────────────────────
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
  // ── Bulk add panel ──────────────────────────────────────────────────────
  bulkPanel: {
    marginBottom: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.card,
    overflow: 'hidden',
  },
  bulkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[4],
    paddingVertical: t.spacing[3],
  },
  bulkHeaderText: {
    ...typeStyle('label'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  bulkChevron: {
    marginLeft: 'auto',
  },
  bulkBody: {
    paddingHorizontal: t.spacing[4],
    paddingBottom: t.spacing[4],
    gap: t.spacing[3],
  },
  bulkPriorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  bulkGroup: {
    gap: t.spacing[2],
  },
  bulkSubLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  bulkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    minHeight: 44,
  },
  bulkChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bulkChipActive: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
  },
  bulkChipText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  bulkChipTextActive: {
    color: t.colors.accent.aqua,
  },
  bulkPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  bulkActionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.bg.secondary,
    minHeight: 44,
    maxWidth: '100%',
  },
  bulkActionPillDisabled: {
    opacity: 0.5,
  },
  bulkActionPillText: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    // No capitalize transform — it mangled multi-word/initialism genres
    // ("drum and bass", "UK garage"). Labels carry their original casing.
    flexShrink: 1,
  },
  bulkActionCount: {
    paddingHorizontal: t.spacing[2],
    paddingVertical: 1,
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  bulkActionCountText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    marginTop: t.spacing[4],
    marginBottom: t.spacing[2],
    minHeight: 44,
  },
  dayLabel: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
    flexShrink: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    marginTop: t.spacing[3],
    marginBottom: t.spacing[1],
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sectionLabel: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  countPill: {
    marginLeft: 'auto',
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.card,
  },
  countText: {
    ...typeStyle('caption'),
    color: t.colors.text.secondary,
  },
  // ── Scroll-to-top FAB ─────────────────────────────────────────────────────
  fab: {
    position: 'absolute',
    right: t.spacing[4],
  },
  fabButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    // Soft elevation so the FAB floats above the list on both platforms.
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
}));
