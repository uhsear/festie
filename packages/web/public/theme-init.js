// Apply the persisted theme before first paint (no flash). Reads the zustand-persist
// entry of @festie/shared uiStore (THEME_STORAGE_KEY). An external file, not inline:
// the CSP has no 'unsafe-inline' and only hashes inline scripts under the root public/.
try {
  var t = JSON.parse(localStorage.getItem('festie-ui-theme-v1') || 'null');
  var s = t && t.state;
  var daylight = s && (s.followSystemTheme === true
    ? window.matchMedia('(prefers-color-scheme: light)').matches
    : s.theme === 'daylight');
  if (daylight) {
    document.documentElement.dataset.theme = 'daylight';
    document.documentElement.style.colorScheme = 'light';
    document.querySelector('meta[name="theme-color"]').setAttribute('content', '#f4f4f7');
  }
} catch (e) {
  /* storage unavailable or malformed: keep the default stage theme */
}
