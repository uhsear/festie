import { makeStyles, typeStyle } from '../../../hooks/useTokens';

export const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[4],
  },
  datePair: {
    flexDirection: 'row',
    gap: t.spacing[3],
  },
  emptyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Stages -------------------------------------------------------------------
  stageBlock: {
    gap: t.spacing[3],
    paddingBottom: t.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.default,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stageHeaderText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  locationText: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flex: 1,
  },
  locationBtn: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  // Days ---------------------------------------------------------------------
  dayBlock: {
    borderWidth: 1,
    borderColor: t.colors.border.default,
    borderRadius: t.radii.default,
    overflow: 'hidden',
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    minHeight: 56,
  },
  chevronBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTitle: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
    flex: 1,
  },
  dayCount: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  dayBody: {
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    padding: t.spacing[3],
    gap: t.spacing[4],
  },
  // Sets ---------------------------------------------------------------------
  setBlock: {
    gap: t.spacing[3],
    padding: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.bg.primary,
    borderWidth: 1,
    borderColor: t.colors.border.default,
  },
  setHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  setHeaderText: {
    ...typeStyle('label', 600),
    color: t.colors.text.secondary,
  },
  setBlockChanged: {
    borderLeftWidth: 3,
    borderLeftColor: t.colors.accent.aqua,
  },
  blockError: {
    borderColor: t.colors.accent.coral,
  },
  changeCaption: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  fieldError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
  },
  pickOnWeb: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Status card --------------------------------------------------------------
  banner: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
    paddingHorizontal: t.spacing[1],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  chip: {
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.default,
    borderWidth: 1,
  },
  chipDraft: {
    borderColor: t.colors.accent.amber,
  },
  chipLive: {
    borderColor: t.colors.accent.aqua,
  },
  chipText: {
    ...typeStyle('caption', 600),
  },
  chipTextDraft: {
    color: t.colors.accent.amber,
  },
  chipTextLive: {
    color: t.colors.accent.aqua,
  },
  statusEdited: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
    flex: 1,
  },
  checklistTitle: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  checkText: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flex: 1,
    minWidth: 160,
  },
  // Buttons ------------------------------------------------------------------
  addBtn: {
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
  addBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.aqua,
  },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: t.spacing[2],
    justifyContent: 'center',
  },
  removeBtnText: {
    ...typeStyle('caption'),
    color: t.colors.accent.coral,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    minHeight: 48,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.light,
    backgroundColor: t.colors.bg.primary,
  },
  toolBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  // Actions ------------------------------------------------------------------
  formError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingHorizontal: t.spacing[1],
  },
  notifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
    paddingHorizontal: t.spacing[1],
  },
  notifyBody: {
    flex: 1,
  },
  notifyTitle: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  notifyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  actions: {
    flexDirection: 'row',
    gap: t.spacing[3],
    marginTop: t.spacing[2],
  },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: t.radii.default,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: t.spacing[4],
  },
  cancelBtn: {
    backgroundColor: t.colors.bg.secondary,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  cancelBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.primary,
  },
  saveBtn: {
    backgroundColor: t.colors.accent.aqua,
  },
  saveBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.text.onLightAccent,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: t.spacing[2],
    minHeight: 48,
    marginTop: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
  },
  deleteBtnText: {
    ...typeStyle('label', 600),
    color: t.colors.accent.coral,
  },
}));
