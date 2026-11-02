import type { AppSectionKey } from '@festie/shared/utils';

export const SECTION_HREF: Record<AppSectionKey, string> = {
  lineup: '/cards',
  myPlan: '/picks',
  crew: '/crew',
  map: '/map',
  more: '/account',
};

const SECTION_PATHS: Record<AppSectionKey, readonly string[]> = {
  lineup: ['/', '/cards', '/timeline', '/grid'],
  myPlan: ['/picks'],
  crew: ['/crew', '/crew-plan', '/compare'],
  map: ['/map'],
  more: ['/account', '/wrap', '/admin'],
};

export function activeSection(pathname: string): AppSectionKey | null {
  const hit = (Object.keys(SECTION_PATHS) as AppSectionKey[]).find((key) => SECTION_PATHS[key].includes(pathname));
  return hit ?? null;
}
