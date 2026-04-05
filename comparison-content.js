// comparison-content.js — injected into comparison windows for scroll/nav sync
(function () {
  'use strict';
  if (window.__ctCompareSyncActive) return;
  window.__ctCompareSyncActive = true;

  let isSyncing = false;
  let scrollTimer = null;

  // ── Scroll reporting ──────────────────────────────────────────────
  function handleScroll() {
    if (isSyncing) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      try {
        chrome.runtime.sendMessage({
          type: 'SC_SCROLL',
          scrollX: window.scrollX,
          scrollY: window.scrollY
        }).catch(() => {});
      } catch (e) {}
    }, 60);
  }
  window.addEventListener('scroll', handleScroll, { passive: true });

  // ── Navigation reporting ──────────────────────────────────────────
  function reportNav() {
    try {
      chrome.runtime.sendMessage({
        type: 'SC_NAVIGATE',
        path: window.location.pathname + window.location.search + window.location.hash
      }).catch(() => {});
    } catch (e) {}
  }
  const _push = history.pushState;
  history.pushState = function () { _push.apply(this, arguments); reportNav(); };
  const _replace = history.replaceState;
  history.replaceState = function () { _replace.apply(this, arguments); reportNav(); };
  window.addEventListener('popstate', reportNav);
  window.addEventListener('hashchange', reportNav);

  // ── Incoming sync commands ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;

    if (msg.type === 'SC_DO_SCROLL') {
      isSyncing = true;
      window.scrollTo({ top: msg.scrollY, left: msg.scrollX, behavior: 'instant' });
      setTimeout(() => { isSyncing = false; }, 150);
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === 'SC_DO_NAVIGATE') {
      isSyncing = true;
      window.location.href = msg.url;
      sendResponse({ ok: true });
      return true;
    }

    return false;
  });
})();
