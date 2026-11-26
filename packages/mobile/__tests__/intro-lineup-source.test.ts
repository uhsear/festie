// Source-level guards (mobile tests run in node with no RN renderer): the plan slide
// must use the shared lineup model, and the slide components must hold no copy literals.
import { read } from './read-source';
import { ONBOARDING_SLIDES_SHARED } from '@festie/shared/constants';

const lineup = read('components/IntroLineup.tsx');
const intro = read('components/FirstRunIntro.tsx');

describe('mobile intro lineup', () => {
  it('builds rows from the shared model', () => {
    expect(lineup).toContain("from '@festie/shared/utils'");
    expect(lineup).toContain('cycleIntroPick');
    expect(lineup).toContain('findIntroClash');
  });

  it('is mounted on the plan slide', () => {
    expect(intro).toContain('<IntroLineup />');
  });

  it('holds no slide copy literals', () => {
    for (const slide of ONBOARDING_SLIDES_SHARED) {
      expect(intro).not.toContain(slide.title);
      expect(intro).not.toContain(slide.description);
      expect(lineup).not.toContain(slide.title);
    }
  });
});
