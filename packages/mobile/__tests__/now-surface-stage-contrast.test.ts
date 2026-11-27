// The stage colour comes from the server, so no stage can be trusted to reach 3:1 on the pale-green live fill
// (crimson measured 2.84:1 in light). The Now & Next hero titles stay text.primary; the stage shows as a dot.
import { describe, it, expect } from 'vitest';
import { read } from './read-source';

const src = read('components/NowSurface.tsx').replace(/\r\n/g, '\n');

describe('Now & Next hero stage colour', () => {
  it('never colours the artist title with the stage colour', () => {
    expect(src).not.toMatch(/style=\{\[s\.artist,/);
    expect(src).toContain("artist: { ...typeStyle('display-lg'), color: t.colors.text.primary }");
  });

  it('marks the stage with a dot on both the live and the next card', () => {
    expect(src).toContain('stageDot(set.stageId)');
    expect(src).toContain('stageDot(next.set.stageId)');
    expect(src).toContain('backgroundColor: color');
  });
});
