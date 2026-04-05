// staging-compare.js — Staging vs. Prod side-by-side comparison
'use strict';

(function initStagingCompare() {
  const panel = document.getElementById('content-stagingcompare');
  if (!panel) return;

  const prodInput    = document.getElementById('scProdUrl');
  const stagingInput = document.getElementById('scStagingUrl');
  const swapBtn      = document.getElementById('scSwapBtn');
  const autoBtn      = document.getElementById('scAutoDetect');
  const openBtn      = document.getElementById('scOpenBtn');
  const closeBtn     = document.getElementById('scCloseBtn');
  const statusEl     = document.getElementById('scStatus');
  const syncScrollEl = document.getElementById('scSyncScroll');
  const syncNavEl    = document.getElementById('scSyncNav');
  const modeDesktop  = document.getElementById('scModeDesktop');
  const modeMobile   = document.getElementById('scModeMobile');
  const activeBar    = document.getElementById('scActiveBar');

  if (!openBtn) return;

  let sessionActive = false;
  let currentMode   = 'desktop';

  // ── Helpers ─────────────────────────────────────────────────────
  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'sc-status' + (cls ? ' ' + cls : '');
  }

  function setSessionUI(active) {
    sessionActive = active;
    if (openBtn)  openBtn.style.display  = active ? 'none' : 'flex';
    if (closeBtn) closeBtn.style.display = active ? 'flex' : 'none';
    if (activeBar) activeBar.classList.toggle('hidden', !active);
  }

  function detectOpposite(url) {
    try {
      const u = new URL(url);
      const h = u.hostname;
      if (/^(staging|uat|dev|test|qa)\./i.test(h)) {
        u.hostname = h.replace(/^(staging|uat|dev|test|qa)\./i, 'www.');
        return u.toString();
      }
      u.hostname = 'uat.' + h.replace(/^www\./i, '');
      return u.toString();
    } catch (e) { return ''; }
  }

  async function loadTrackedUrl() {
    try {
      const tracked = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_TRACKED' }, r));
      const url = tracked?.trackedUrl;
      if (!url) return;
      if (prodInput && !prodInput.value) prodInput.value = url;
      if (stagingInput && !stagingInput.value) {
        const opp = detectOpposite(url);
        if (opp) stagingInput.value = opp;
      }
    } catch (e) {}
  }

  // ── Check existing session on init ────────────────────────────────
  async function checkSession() {
    try {
      const resp = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_SC_SESSION' }, r));
      setSessionUI(resp?.active === true);
    } catch (e) {}
  }

  // ── Mode pills ───────────────────────────────────────────────────
  function setMode(mode) {
    currentMode = mode;
    if (modeDesktop) modeDesktop.classList.toggle('active', mode === 'desktop');
    if (modeMobile)  modeMobile.classList.toggle('active', mode === 'mobile');
  }
  if (modeDesktop) modeDesktop.addEventListener('click', () => setMode('desktop'));
  if (modeMobile)  modeMobile.addEventListener('click', () => setMode('mobile'));

  // ── Swap & auto-fill ─────────────────────────────────────────────
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      if (prodInput) prodInput.value = '';
      if (stagingInput) stagingInput.value = '';
      loadTrackedUrl();
    });
  }
  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      if (!prodInput || !stagingInput) return;
      const tmp = prodInput.value;
      prodInput.value = stagingInput.value;
      stagingInput.value = tmp;
    });
  }

  // ── Sync option live update ───────────────────────────────────────
  function pushSyncOpts() {
    if (!sessionActive) return;
    chrome.runtime.sendMessage({
      type: 'SC_UPDATE_OPTS',
      syncScroll: syncScrollEl?.checked !== false,
      syncNav:    syncNavEl?.checked    !== false
    }).catch(() => {});
  }
  if (syncScrollEl) syncScrollEl.addEventListener('change', pushSyncOpts);
  if (syncNavEl)    syncNavEl.addEventListener('change', pushSyncOpts);

  // ── Open comparison ───────────────────────────────────────────────
  openBtn.addEventListener('click', async () => {
    const url1 = (prodInput?.value || '').trim();
    const url2 = (stagingInput?.value || '').trim();

    if (!url1 || !url2) { setStatus('Enter both URLs first.', 'warn'); return; }
    try { new URL(url1); } catch (e) { setStatus('Production URL is not valid.', 'fail'); return; }
    try { new URL(url2); } catch (e) { setStatus('Staging URL is not valid.', 'fail'); return; }

    setStatus('Opening…');
    openBtn.disabled = true;

    try {
      const resp = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 10000);
        chrome.runtime.sendMessage({
          type: 'OPEN_COMPARISON',
          url1,
          url2,
          mode: currentMode,
          syncScroll: syncScrollEl?.checked !== false,
          syncNav:    syncNavEl?.checked    !== false,
          screenW: window.screen.availWidth,
          screenH: window.screen.availHeight
        }, r => { clearTimeout(t); resolve(r); });
      });

      if (resp?.ok) {
        setStatus('');
        setSessionUI(true);
      } else {
        setStatus('Could not open windows: ' + (resp?.error || 'unknown'), 'fail');
      }
    } catch (e) {
      setStatus('Error: ' + (e.message || 'unknown'), 'fail');
    }

    openBtn.disabled = false;
  });

  // ── Close comparison ──────────────────────────────────────────────
  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      closeBtn.disabled = true;
      closeBtn.textContent = 'Closing…';
      try {
        await new Promise(r => chrome.runtime.sendMessage({ type: 'CLOSE_COMPARISON' }, r));
      } catch (e) {}
      setSessionUI(false);
      setStatus('Comparison closed.');
      closeBtn.disabled = false;
      closeBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
        Close Comparison`;
    });
  }

  // ── Listen for session ended (window manually closed) ─────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'SC_SESSION_ENDED') setSessionUI(false);
  });

  // ── Init ──────────────────────────────────────────────────────────
  setMode('desktop');
  checkSession();

  const obs = new MutationObserver(() => {
    if (panel.classList.contains('active') && prodInput && !prodInput.value) loadTrackedUrl();
  });
  obs.observe(panel, { attributes: true, attributeFilter: ['class'] });

  loadTrackedUrl();
})();
