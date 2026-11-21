/**
 * Lighthouse CI config for @festie/web, mobile preset.
 *
 * Same URLs and assertions as `.lighthouserc.cjs` (desktop). lhci takes one
 * preset per run, so CI runs the two configs one after the other. Omitting
 * `preset` selects Lighthouse's default: mobile emulation plus slow-4G and
 * 4x CPU throttling.
 */
const desktop = require('./.lighthouserc.cjs');

const { preset, ...mobileSettings } = desktop.ci.collect.settings;

module.exports = {
  ci: {
    ...desktop.ci,
    // One run per URL keeps the job inside its timeout; mobile performance only warns.
    collect: { ...desktop.ci.collect, numberOfRuns: 1, settings: mobileSettings },
  },
};
