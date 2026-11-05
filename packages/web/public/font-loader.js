// Apply the Google Fonts stylesheet without blocking first paint. index.html preloads
// it; a script-inserted stylesheet is not render-blocking. An external file, not the
// media="print" onload= swap: the CSP forbids inline handlers (script-src-attr 'none').
var link = document.createElement('link');
link.rel = 'stylesheet';
// crossOrigin lets html-to-image read the sheet's rules when it inlines fonts into exports.
link.crossOrigin = 'anonymous';
link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap';
document.head.appendChild(link);
