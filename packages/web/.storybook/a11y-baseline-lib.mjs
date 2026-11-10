/**
 * Pure logic for the axe baseline ratchet (no I/O, unit-tested in
 * a11y-baseline-lib.test.mjs). Shapes:
 *   counts:   { [storyId]: { [ruleId]: nodeCount } }   minor + moderate only
 *   baseline: { version: 1, stories: counts }
 */

export const BASELINE_VERSION = 1;

/** Fold per-story result files ({ id, counts }) into one counts map; empty stories are dropped. */
export function mergeResults(results) {
  const merged = {};
  for (const { id, counts } of results) {
    const rules = Object.entries(counts ?? {}).filter(([, n]) => n > 0);
    if (rules.length) merged[id] = Object.fromEntries(rules);
  }
  return merged;
}

/**
 * A story's rule fails when its count exceeds the baseline (absent = 0, so new
 * stories and new rules start at zero). Lower counts are improvements: they
 * never fail, they only prompt a baseline refresh.
 */
export function compareToBaseline(current, baseline) {
  const regressions = [];
  const improvements = [];
  const allowed = baseline?.stories ?? {};

  for (const [story, rules] of Object.entries(current)) {
    for (const [rule, count] of Object.entries(rules)) {
      const base = allowed[story]?.[rule] ?? 0;
      if (count > base) regressions.push({ story, rule, baseline: base, current: count });
    }
  }
  for (const [story, rules] of Object.entries(allowed)) {
    for (const [rule, base] of Object.entries(rules)) {
      const count = current[story]?.[rule] ?? 0;
      if (count < base) improvements.push({ story, rule, baseline: base, current: count });
    }
  }
  return { regressions, improvements };
}

/** Deterministic serialisation (sorted keys, no timestamp) so baseline diffs stay reviewable. */
export function serializeBaseline(counts) {
  const stories = {};
  for (const story of Object.keys(counts).sort()) {
    stories[story] = Object.fromEntries(
      Object.entries(counts[story]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  }
  return `${JSON.stringify({ version: BASELINE_VERSION, stories }, null, 2)}\n`;
}

export function formatDiff({ story, rule, baseline, current }) {
  return `${story}: ${rule} ${current} (baseline ${baseline})`;
}
