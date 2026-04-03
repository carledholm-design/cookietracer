// emulator-sync.js — content script injected into all frames
// Bridges scroll and navigation events between iframes and the emulator view page

'use strict';

// Only activate inside iframes (not top-level pages)
if (window !== window.top) {
  let scrollLock = false;
  let rafPending = false;

  // ── Scroll: post position to parent ──────────────────────────────────

  window.addEventListener('scroll', () => {
    if (scrollLock || rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (scrollLock) return;
      try {
        window.parent.postMessage({
          type: 'CT_EMULATOR_SCROLL',
          x: window.scrollX,
          y: window.scrollY
        }, '*');
      } catch (_) {}
    });
  }, { passive: true });

  // ── Scroll: receive command from parent ───────────────────────────────

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'CT_EMULATOR_SCROLL_TO') {
      scrollLock = true;
      try {
        window.scrollTo({ left: e.data.x, top: e.data.y, behavior: 'instant' });
      } catch {
        window.scrollTo(e.data.x, e.data.y);
      }
      setTimeout(() => { scrollLock = false; }, 120);
    }
  });

  // ── Navigation: intercept SPA history changes ─────────────────────────

  const postNav = () => {
    try {
      window.parent.postMessage({ type: 'CT_EMULATOR_NAV', url: location.href }, '*');
    } catch (_) {}
  };

  try {
    const origPush    = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);

    history.pushState = function (...args) {
      origPush(...args);
      postNav();
    };

    history.replaceState = function (...args) {
      origReplace(...args);
      postNav();
    };

    window.addEventListener('popstate', postNav);
  } catch (_) {}

  // ── Announce current URL on load (catches full-page navigations) ──────

  try {
    window.parent.postMessage({ type: 'CT_EMULATOR_LOADED', url: location.href }, '*');
  } catch (_) {}
}
