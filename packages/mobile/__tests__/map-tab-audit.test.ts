import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'components/OfflineMap.tsx'), 'utf8');

describe('OfflineMap audit source guards', () => {
  it('offers a retry after a load failure instead of latching the fallback', () => {
    expect(src).toContain('const retryMap = useCallback');
    expect(src).toContain("fellBackRef.current = false;\n    setPhase('loading');");
    expect(src).toContain('label="Retry map"');
    expect(src).toContain("The map didn't load.");
  });

  it('replays one-shot framing and disarms placement when the document reloads', () => {
    const ready = src.slice(src.indexOf("msg.type === 'ready'"), src.indexOf("msg.type === 'pursue-select'"));
    expect(ready).toContain('fitBoundsRef.current = false');
    expect(ready).toContain('framedSosRef.current = new Set()');
    expect(ready).toContain('setPlacing(false)');
    // refs must be declared before the onMessage callback that uses them
    expect(src.indexOf('const fitBoundsRef')).toBeLessThan(src.indexOf('const onMessage'));
    expect(src.indexOf('const framedSosRef')).toBeLessThan(src.indexOf('const onMessage'));
  });

  it('fallback list clears the native tab bar and hides the crew-only empty copy from guests', () => {
    expect(src).toContain('paddingBottom: bottomPad + bottomInset');
    expect(src).toContain('{!hasAny && onSetMeetingPoint ? (');
  });

  it('pursue bar keeps distance and ETA on their own line with a real close target', () => {
    const bar = src.slice(src.indexOf('<View style={styles.pursueBody}>'), src.indexOf('styles.pursueClose'));
    expect(bar).toContain('style={styles.pursueName} numberOfLines={1}');
    expect(bar).not.toContain('<Text style={styles.pursueName}>');
    const close = src.slice(src.indexOf('  pursueClose: {'), src.indexOf('  noticeRow: {'));
    expect(close).toContain('minWidth: 32');
    expect(close).toContain('minHeight: 32');
  });

  it('recenter reuses the shared watch fix and no longer runs a one-shot GPS request', () => {
    expect(src).not.toContain('getCurrentPositionAsync');
    expect(src).not.toContain('setLocating');
    expect(src).toContain('const [pendingRecenter, setPendingRecenter]');
    expect(src).toContain('interactive && (nearestNotice || pendingNearest || pendingRecenter)');
  });

  it('pushes the self position into the document', () => {
    expect(src).toContain('window.__festieSetSelf');
  });

  it('a card or pursue pick cancels a pending Nearest', () => {
    const select = src.slice(src.indexOf('const selectPin = useCallback'), src.indexOf('Close a card whose pin'));
    expect(select).toContain('setPendingNearest(null)');
    const pursue = src.slice(src.indexOf("msg.type === 'pursue-select'"), src.indexOf("msg.type === 'place-select'"));
    expect(pursue).toContain('setPendingNearest(null)');
  });

  it('the Nearest notice can be dismissed', () => {
    expect(src).toContain('accessibilityLabel="Dismiss"');
  });

  it('FABs use the same platform inset rule as the SOS FAB', () => {
    expect(src).toContain("const fabInset = (Platform.OS === 'ios' ? insets.bottom : 0) + bottomInset;");
    expect(src).toContain('styles.dropPinButton.bottom + fabInset');
    expect(src).toContain('styles.recenterFab.bottom + fabInset');
  });
});

describe('map GPS watch lifecycle', () => {
  it('stops the location watch when the Map screen loses focus', () => {
    const src = readFileSync(join(__dirname, '../components/OfflineMap.tsx'), 'utf8');
    expect(src).toMatch(/useFocusEffect\(\s*useCallback\(\(\) => \{[\s\S]*?return \(\) => \{\s*watchSubRef\.current\?\.remove\(\);/);
  });
});
