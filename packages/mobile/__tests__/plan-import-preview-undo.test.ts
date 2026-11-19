import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '..', 'components/PlanQRScan.tsx'), 'utf8');

describe('t3 plan import preview and undo', () => {
  it('previews before writing and supports undo', () => {
    expect(src).toContain('previewPlanImport');
    expect(src).toContain("'preview'");
    expect(src).toContain('restorePicks');
  });

  it('does not write picks inside handleScanned', () => {
    const start = src.indexOf('const handleScanned');
    const end = src.indexOf('const reset');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(src.slice(start, end)).not.toContain('bulkSavePicks');
  });
});
