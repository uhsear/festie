import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SegmentedTablist from './SegmentedTablist';

const options = [
  { value: 'a', label: 'One' },
  { value: 'b', label: 'Two' },
] as const;

describe('SegmentedTablist radius', () => {
  it('draws the strip at rounded-xl and every tab at rounded-lg, the strip radius minus its p-1 padding', () => {
    render(<SegmentedTablist label="Test" panelId="p" options={options} value="a" onChange={() => {}} />);
    const strip = screen.getByRole('tablist');
    expect(strip.className).toContain('rounded-xl');
    expect(strip.className).toContain('p-1');
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).toContain('rounded-lg');
  });

  it('keeps the radius when a caller passes layout classes only', () => {
    render(
      <SegmentedTablist
        label="Test"
        panelId="p"
        options={options}
        value="b"
        onChange={() => {}}
        tone="solid"
        className="grid grid-cols-2 gap-1 bg-bg-card"
        tabClassName="min-h-[40px] text-sm"
      />,
    );
    expect(screen.getByRole('tablist').className).toContain('rounded-xl');
    expect(screen.getByRole('tab', { name: 'Two' }).className).toContain('rounded-lg');
  });
});
