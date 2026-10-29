import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StageBadge, { CHIP_TINT_ALPHA, getStageBadgeStyle, inactiveChipTextColor, stageTextColor } from './StageBadge';

describe('StageBadge', () => {
  it('renders the stage name', () => {
    render(<StageBadge stageName="Main Stage" stageColor="#ff3366" />);
    expect(screen.getByText('Main Stage')).toBeInTheDocument();
  });

  it('renders a span with the stage name as text', () => {
    render(<StageBadge stageName="Sahara" stageColor="#00aaff" />);
    const badge = screen.getByText('Sahara');
    expect(badge.tagName).toBe('SPAN');
  });

  it('applies default variant class', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" />);
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('rounded-full');
    // uppercase/tracking/weight come from the type-micro utility (theme.css)
    expect(badge.className).toContain('type-micro');
  });

  it('applies chip variant class', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" variant="chip" />);
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('cursor-pointer');
  });

  it('applies pick variant class', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" variant="pick" />);
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('rounded-full');
    expect(badge.className).toContain('type-micro');
  });

  it('adds active styling for active chip variant', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" variant="chip" active />);
    const badge = screen.getByText('Main');
    expect(badge.className).toContain('border-current');
  });

  it('does not add active styling for inactive chip', () => {
    render(<StageBadge stageName="Main" stageColor="#ff0000" variant="chip" active={false} />);
    const badge = screen.getByText('Main');
    expect(badge.className).not.toContain('border-current');
  });

  it('applies custom className', () => {
    render(<StageBadge stageName="Test" stageColor="#000" className="my-custom" />);
    const badge = screen.getByText('Test');
    expect(badge.className).toContain('my-custom');
  });

  it('applies custom style', () => {
    render(<StageBadge stageName="Test" stageColor="#000" style={{ marginLeft: '4px' }} />);
    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ marginLeft: '4px' });
  });

  it('renders as a span element', () => {
    render(<StageBadge stageName="Test" stageColor="#000" />);
    expect(screen.getByText('Test').tagName).toBe('SPAN');
  });
});

describe('getStageBadgeStyle', () => {
  it('returns white text for default variant', () => {
    const style = getStageBadgeStyle('#ff3366');
    expect(style.color).toBe('var(--color-text-on-accent)');
    expect(style.fontWeight).toBe(700);
  });

  it('returns faded style for inactive chip', () => {
    const style = getStageBadgeStyle('#ff3366', 'chip', false);
    expect(style.color).toBe('#ff3366');
    expect(style.borderColor).toBe('transparent');
    expect(style.background).toContain('#ff3366');
    expect(style.background).toContain('20'); // alpha hex suffix
  });

  it('returns solid style for active chip', () => {
    const style = getStageBadgeStyle('#ff3366', 'chip', true);
    expect(style.color).toBe('var(--color-text-on-accent)');
    expect(style.fontWeight).toBe(700);
  });

  it('darkens light colors to maintain white contrast', () => {
    // Pure white would need significant darkening
    const style = getStageBadgeStyle('#ffffff');
    expect(style.background).not.toBe('#ffffff');
    expect(style.color).toBe('var(--color-text-on-accent)');
  });

  it('preserves already-dark colors', () => {
    const style = getStageBadgeStyle('#000000');
    expect(style.background).toBe('#000000');
    expect(style.color).toBe('var(--color-text-on-accent)');
  });

  it('handles 3-digit hex', () => {
    const style = getStageBadgeStyle('#f36');
    expect(style.color).toBe('var(--color-text-on-accent)');
    expect(style.background).toBeTruthy();
  });

  it('handles invalid hex gracefully', () => {
    const style = getStageBadgeStyle('not-a-color');
    expect(style.background).toBe('not-a-color');
    expect(style.color).toBe('var(--color-text-on-accent)');
  });

  it('returns text-shadow for accessibility', () => {
    const style = getStageBadgeStyle('#ff3366');
    expect(style.textShadow).toContain('rgba(0, 0, 0');
  });
});

function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Compare and the detail panel print the stage name in the stage colour. Dark
// stage colours (deep purple, brick red) measured 2.1:1 and 3.4:1 on the Stage
// ground before the solver ran in both themes.
describe('stageTextColor', () => {
  for (const stage of ['#5b21b6', '#b91c1c', '#ffd400', '#00e8d0']) {
    it(`${stage} reaches 4.5:1 on the Stage ground`, () => {
      expect(ratio(stageTextColor(stage, 'stage'), '#080810')).toBeGreaterThanOrEqual(4.5);
    });
    it(`${stage} reaches 4.5:1 on the Daylight ground`, () => {
      expect(ratio(stageTextColor(stage, 'daylight'), '#f4f4f7')).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('leaves an already-legible stage colour unchanged', () => {
    expect(stageTextColor('#00e8d0', 'stage')).toBe('#00e8d0');
  });
});

// Local axe run, 2026-10-29: the detail-panel stage pill measured 3.66:1 (Stage) and 4.47:1 (Daylight)
// over the glass panel. It now paints bg-primary under the tint and solves against that composite.
function tintOver(stage: string, ground: string): string {
  const [s, g] = [stage, ground].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
  return '#' + s!.map((c, i) => Math.round(c * CHIP_TINT_ALPHA + g![i]! * (1 - CHIP_TINT_ALPHA)).toString(16).padStart(2, '0')).join('');
}
describe('inactiveChipTextColor', () => {
  for (const stage of ['#5b21b6', '#b91c1c', '#ffd400', '#00e8d0', '#1f8a63']) {
    it(`${stage} reaches 4.5:1 on its tinted pill in both themes`, () => {
      expect(ratio(inactiveChipTextColor(stage, 'stage'), tintOver(stage, '#080810'))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(inactiveChipTextColor(stage, 'daylight'), tintOver(stage, '#f4f4f7'))).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// Prod axe run, 2026-10-29: an inactive sub-header chip for a #c8102e stage (solved to #f5163b) drew on
// a #220b16 composite (the header surface, not the canvas) and measured 4.48:1.
describe('inactive stage chip on a non-canvas surface', () => {
  it('keeps 4.5:1 on the measured sub-header composite', () => {
    // The live Stage ground (#0a0a0a), as the browser reads it; jsdom has no stylesheet.
    document.documentElement.style.setProperty('--color-bg-primary', '#0a0a0a');
    const { color } = getStageBadgeStyle('#c8102e', 'chip', false, 'stage');
    document.documentElement.style.removeProperty('--color-bg-primary');
    expect(ratio(String(color), '#220b16')).toBeGreaterThanOrEqual(4.5);
  });
});
