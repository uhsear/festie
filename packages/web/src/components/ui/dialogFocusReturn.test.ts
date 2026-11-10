import { describe, it, expect } from 'vitest';

const sources = import.meta.glob('/src/**/*.tsx', { query: '?raw', eager: true, import: 'default' }) as Record<
  string,
  string
>;

describe('Dialog and sheet focus return', () => {
  it('every file that renders Dialog Content has a Trigger or useReturnFocus', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.(test|stories)\.tsx$/.test(path))
      .filter(([, src]) => src.includes('@radix-ui/react-dialog') && /\.Content\b/.test(src))
      .filter(([, src]) => !src.includes('.Trigger') && !src.includes('useReturnFocus'))
      .map(([path]) => path);
    expect(
      offenders,
      `${offenders.join(', ')}: Use ui/Dialog, or spread useReturnFocus() on Content`,
    ).toEqual([]);
  });

  it('every vaul sheet restores focus with onCloseAutoFocus or useReturnFocus', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !/\.(test|stories)\.tsx$/.test(path))
      .filter(([, src]) => src.includes("from 'vaul'") && /\.Content\b/.test(src))
      .filter(([, src]) => !src.includes('onCloseAutoFocus') && !src.includes('useReturnFocus'))
      .map(([path]) => path);
    expect(
      offenders,
      `${offenders.join(', ')}: Use ui/Sheet, or set onCloseAutoFocus on Drawer.Content`,
    ).toEqual([]);
  });
});
