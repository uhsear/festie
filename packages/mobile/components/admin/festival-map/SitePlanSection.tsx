import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isHttpsUrl, SITEPLAN_CORNER_COUNT, type MapSiteplan } from '@festie/shared/utils';
import SectionLabel from '../../SectionLabel';
import { LabeledTextInput } from '..';
import { useTokens } from '../../../hooks/useTokens';
import { useStyles } from './styles';
import type { Vertex } from './types';

// Discrete opacity steps for the site-plan overlay. React Native has no
// `<input type=range>` and Festie ships no slider native module, so the editor
// offers preset chips (pure JS, OTA-safe) instead of a continuous slider — the
// default (SITEPLAN_DEFAULT_OPACITY = 0.6) is one of the stops.
const SITEPLAN_OPACITY_PRESETS = [0.3, 0.45, 0.6, 0.75, 0.9] as const;

interface SitePlanSectionProps {
  applySiteplanCorners: () => void;
  cancelSiteplanCorners: () => void;
  committedSiteplan: MapSiteplan | null;
  draftCorners: Vertex[];
  isPlacingSiteplan: boolean;
  onSiteplanOpacityChange: (v: number) => void;
  onSiteplanUrlChange: (v: string) => void;
  pickAndUploadSiteplan: () => Promise<void>;
  removeSiteplanOverlay: () => void;
  siteplanOpacity: number;
  siteplanUrl: string;
  startSiteplanCorners: () => void;
  undoCorner: () => void;
  uploadNote: { text: string; error: boolean; } | null;
  uploading: boolean;
}

export default function SitePlanSection({
  applySiteplanCorners,
  cancelSiteplanCorners,
  committedSiteplan,
  draftCorners,
  isPlacingSiteplan,
  onSiteplanOpacityChange,
  onSiteplanUrlChange,
  pickAndUploadSiteplan,
  removeSiteplanOverlay,
  siteplanOpacity,
  siteplanUrl,
  startSiteplanCorners,
  undoCorner,
  uploadNote,
  uploading,
}: SitePlanSectionProps) {
  const styles = useStyles();
  const t = useTokens();
  return (
    <>
      <SectionLabel>Site plan overlay</SectionLabel>
      <View style={styles.card}>
        <Text style={styles.emptyHint}>
          Upload the organiser's site-plan image (PNG, JPEG or WebP, up to 10 MB), or paste an https link. Then mark
          the four corners: top-left, top-right, bottom-right, bottom-left. Got a PDF? Save the page as a PNG first.
        </Text>
        <TouchableOpacity
          onPress={() => void pickAndUploadSiteplan()}
          disabled={uploading}
          style={[styles.armBtn, styles.zoneStartBtn, uploading ? styles.btnDisabled : null]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Upload a site-plan image"
        >
          <Text style={styles.armBtnText}>{uploading ? 'Uploading…' : 'Upload image'}</Text>
        </TouchableOpacity>
        {uploadNote ? (
          <Text style={uploadNote.error ? styles.formError : styles.emptyHint} accessibilityLiveRegion="polite">
            {uploadNote.text}
          </Text>
        ) : null}
        <LabeledTextInput
          label="Site-plan image URL"
          value={siteplanUrl}
          onChangeText={onSiteplanUrlChange}
          placeholder="https://…/site-plan.png"
          keyboardType="url"
          autoCapitalize="none"
          maxLength={2048}
          error={
            siteplanUrl.trim() !== '' && !isHttpsUrl(siteplanUrl) ? 'Image link must start with https://' : null
          }
        />

        {isPlacingSiteplan ? (
          <View style={styles.zoneControls}>
            <Text style={styles.zonePointCount}>
              {draftCorners.length}/{SITEPLAN_CORNER_COUNT} corners
            </Text>
            <TouchableOpacity
              onPress={undoCorner}
              disabled={draftCorners.length === 0}
              style={[styles.zoneBtn, draftCorners.length === 0 ? styles.btnDisabled : null]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Undo last corner"
            >
              <Text style={styles.zoneBtnText}>Undo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={applySiteplanCorners}
              disabled={draftCorners.length !== SITEPLAN_CORNER_COUNT || !isHttpsUrl(siteplanUrl)}
              style={[
                styles.zoneBtnPrimary,
                draftCorners.length !== SITEPLAN_CORNER_COUNT || !isHttpsUrl(siteplanUrl)
                  ? styles.btnDisabled
                  : null,
              ]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Apply the four corners"
            >
              <Text style={styles.zoneBtnPrimaryText}>Apply</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={cancelSiteplanCorners}
              style={styles.zoneBtnDanger}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Cancel placing corners"
            >
              <Text style={styles.zoneBtnDangerText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={startSiteplanCorners}
            disabled={!isHttpsUrl(siteplanUrl)}
            style={[styles.armBtn, styles.zoneStartBtn, !isHttpsUrl(siteplanUrl) ? styles.btnDisabled : null]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={committedSiteplan ? 'Re-place site-plan corners' : 'Set site-plan corners'}
          >
            <Text style={styles.armBtnText}>{committedSiteplan ? 'Re-place corners' : 'Set corners'}</Text>
          </TouchableOpacity>
        )}

        {/* Opacity presets — only meaningful once an overlay is committed. */}
        {committedSiteplan ? (
          <View style={styles.opacityBlock}>
            <Text style={styles.zonePointCount}>Opacity: {Math.round(siteplanOpacity * 100)}%</Text>
            <View style={styles.palette}>
              {SITEPLAN_OPACITY_PRESETS.map((op) => {
                const selected = Math.round(siteplanOpacity * 100) === Math.round(op * 100);
                return (
                  <TouchableOpacity
                    key={op}
                    onPress={() => onSiteplanOpacityChange(op)}
                    style={[styles.opacityChip, selected ? styles.opacityChipOn : null]}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Set overlay opacity to ${Math.round(op * 100)} percent`}
                  >
                    <Text style={[styles.opacityChipText, selected ? styles.opacityChipTextOn : null]}>
                      {Math.round(op * 100)}%
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {committedSiteplan ? (
          <View style={styles.placedList}>
            <View style={styles.placedRow}>
              <Text style={styles.placedLabel} numberOfLines={1}>
                Overlay set ({SITEPLAN_CORNER_COUNT} corners)
              </Text>
              <TouchableOpacity
                onPress={removeSiteplanOverlay}
                style={styles.miniBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Remove site-plan overlay"
              >
                <Ionicons name="close" size={t.iconSize.sm} color={t.colors.accent.coral} />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </View>
    </>
  );
}
