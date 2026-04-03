// Console Capture â€” injected into pages to catch JS errors
// Wraps console.error/warn and catches unhandled exceptions

(function() {
  'use strict';
  
  // Avoid double-injection
  if (window.__ctConsoleCapture) return;
  window.__ctConsoleCapture = true;

  function send(level, message, source, lineno, colno, stack) {
    try {
      chrome.runtime.sendMessage({
        type: 'CONSOLE_ERROR',
        level: level,
        message: String(message).substring(0, 2000),
        source: source || '',
        lineno: lineno || null,
        colno: colno || null,
        stack: stack ? String(stack).substring(0, 5000) : null,
        url: window.location.href
      }).catch(() => {});
    } catch (e) {
      // Extension context invalidated, ignore
    }
  }

  // Wrap console.error
  const origError = console.error;
  console.error = function(...args) {
    const msg = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); }
      return String(a);
    }).join(' ');
    
    const stack = args.find(a => a instanceof Error)?.stack || null;
    send('error', msg, '', null, null, stack);
    return origError.apply(console, args);
  };

  // Wrap console.warn
  const origWarn = console.warn;
  console.warn = function(...args) {
    const msg = args.map(a => {
      if (a instanceof Error) return a.message;
      if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); }
      return String(a);
    }).join(' ');
    
    send('warn', msg);
    return origWarn.apply(console, args);
  };

  // Catch unhandled errors
  window.addEventListener('error', (event) => {
    // Skip resource loading errors (images, scripts) â€” only JS errors
    if (event.target !== window) return;
    
    send(
      'error',
      event.message || 'Unknown error',
      event.filename || '',
      event.lineno,
      event.colno,
      event.error?.stack || null
    );
  });

  // Catch unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection');
    const stack = reason instanceof Error ? reason.stack : null;
    send('error', `[Unhandled Rejection] ${msg}`, '', null, null, stack);
  });
})();
