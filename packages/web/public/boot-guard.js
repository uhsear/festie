// Recovery for a boot that never reaches React (#485: a failed or throwing bundle left
// "Loading Festie…" on screen for hours). Swaps the static boot shell for a message, a
// Reload button and a status link. An external file, not inline: the CSP forbids inline
// scripts and inline handlers (script-src-attr 'none').
(function () {
  var TIMEOUT_MS = 20000;
  var STATUS_URL = 'https://github.com/uhsear/upptime';
  var shown = false;

  function show(slow) {
    var shell = document.querySelector('.boot-shell');
    // React replaces the shell when it mounts, so no shell means the app booted.
    if (shown || !shell) return;
    shown = true;
    shell.setAttribute('role', 'alert');
    shell.textContent = '';

    var heading = document.createElement('strong');
    heading.textContent = slow === true ? 'Still loading…' : 'Festie didn’t finish loading';
    var hint = document.createElement('span');
    hint.textContent = slow === true
      ? 'This is taking a while. Reload if it doesn’t clear, or check the status page.'
      : 'Check your connection and reload. If it keeps happening, check the status page.';
    var reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    reload.addEventListener('click', function () {
      window.location.reload();
    });
    var status = document.createElement('a');
    status.href = STATUS_URL;
    status.rel = 'noopener noreferrer';
    status.textContent = 'Status page';
    shell.append(heading, hint, reload, status);
  }

  // Capture phase also sees a failed module script (a resource error does not bubble).
  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      if (target === window) {
        // Ignore scripts from other origins (browser extensions): they are not the app failing.
        if (event.filename && event.filename.indexOf(window.location.origin) !== 0) return;
      } else if (!(target instanceof HTMLScriptElement) || target.src.indexOf(window.location.origin) !== 0) {
        // A blocked font, stylesheet or image is not a failed boot.
        return;
      }
      show();
    },
    true,
  );
  window.addEventListener('unhandledrejection', function () {
    show();
  });
  window.setTimeout(function () {
    show(true);
  }, TIMEOUT_MS);
})();
