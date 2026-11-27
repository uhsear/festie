import { makeStyles, typeStyle } from '../../../hooks/useTokens';

export const useStyles = makeStyles((t) => ({
  screen: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  flex: {
    flex: 1,
  },
  mapWrap: {
    height: 300,
    width: '100%',
  },
  armedBanner: {
    position: 'absolute',
    top: t.spacing[3],
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[3],
    paddingVertical: t.spacing[2],
    borderRadius: t.radii.pill,
    backgroundColor: t.colors.accent.aqua,
    maxWidth: '90%',
  },
  armedBannerText: {
    ...typeStyle('micro'),
    color: t.colors.text.onLightAccent,
  },
  scroll: {
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    paddingHorizontal: t.spacing[4],
    paddingTop: t.spacing[3],
    gap: t.spacing[2],
  },
  card: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  emptyHint: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  // Stage rows -----------------------------------------------------------------
  stageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[3],
  },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.colors.border.light,
  },
  stageBody: {
    flex: 1,
    gap: 2,
  },
  stageName: {
    ...typeStyle('body', 600),
    color: t.colors.text.primary,
  },
  stageCoord: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  armBtn: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  armBtnActive: {
    backgroundColor: t.colors.accent.aqua,
  },
  armBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.aqua,
  },
  armBtnTextActive: {
    color: t.colors.text.onLightAccent,
  },
  miniBtn: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Amenity palette ------------------------------------------------------------
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  paletteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[1],
    paddingHorizontal: t.spacing[2],
    paddingVertical: t.spacing[1],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
    minHeight: 44,
  },
  paletteGlyph: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.text.onAccent,
  },
  paletteGlyphText: {
    ...typeStyle('caption'),
  },
  paletteLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
  },
  // Zone drawing ---------------------------------------------------------------
  zoneSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.colors.text.onAccent,
  },
  zoneStartBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: t.spacing[4],
  },
  zoneControls: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: t.spacing[2],
  },
  zonePointCount: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  zoneBtn: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBtnText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  zoneBtnPrimary: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    backgroundColor: t.colors.accent.aqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBtnPrimaryText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.onLightAccent,
  },
  zoneBtnDanger: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.accent.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoneBtnDangerText: {
    ...typeStyle('caption', 600),
    color: t.colors.accent.coral,
  },
  // Site-plan opacity presets --------------------------------------------------
  opacityBlock: {
    gap: t.spacing[2],
  },
  opacityChip: {
    minHeight: 44,
    paddingHorizontal: t.spacing[3],
    borderRadius: t.radii.pill,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opacityChipOn: {
    borderColor: t.colors.accent.aqua,
    backgroundColor: t.colors.accent.aqua,
  },
  opacityChipText: {
    ...typeStyle('caption', 600),
    color: t.colors.text.secondary,
  },
  opacityChipTextOn: {
    color: t.colors.text.onLightAccent,
  },
  nameInput: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flex: 1,
    minHeight: 44,
    paddingHorizontal: t.spacing[2],
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    backgroundColor: t.colors.bg.primary,
  },
  moveBtn: {
    minHeight: 44,
    paddingHorizontal: t.spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Placed amenities -----------------------------------------------------------
  placedList: {
    gap: t.spacing[2],
    borderTopWidth: 1,
    borderTopColor: t.colors.border.default,
    paddingTop: t.spacing[3],
  },
  placedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  placedGlyph: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: t.colors.text.onAccent,
  },
  placedLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.primary,
    flex: 1,
  },
  // Actions --------------------------------------------------------------------
  formError: {
    ...typeStyle('caption'),
    color: t.colors.text.danger,
    paddingHorizontal: t.spacing[1],
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
}));
