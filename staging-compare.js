// staging-compare.js — Staging vs. Prod side-by-side comparison
'use strict';

(function initStagingCompare() {
  const panel = document.getElementById('content-stagingcompare');
  if (!panel) return;

  const prodInput    = document.getElementById('scProdUrl');
  const stagingInput = document.getElementById('scStagingUrl');
  const openBtn      = document.getElementById('scOpenBtn');
  const swapBtn      = document.getElementById('scSwapBtn');
  const autoBtn      = document.getElementById('scAutoDetect');
  const statusEl     = document.getElementById('scStatus');

  if (!openBtn) return;

  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'sc-status' + (cls ? ' ' + cls : '');
  }

  function detectOpposite(url) {
    try {
      const u = new URL(url);
      const h = u.hostname;
      if (/^(staging|uat|dev|test|qa)\./i.test(h)) {
        u.hostname = h.replace(/^(staging|uat|dev|test|qa)\./i, 'www.');
        return u.toString();
      }
      if (/^www\./i.test(h)) {
        u.hostname = 'uat.' + h.replace(/^www\./i, '');
        return u.toString();
      }
      u.hostname = 'uat.' + h;
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

  openBtn.addEventListener('click', async () => {
    const url1 = (prodInput?.value || '').trim();
    const url2 = (stagingInput?.value || '').trim();

    if (!url1 || !url2) { setStatus('Enter both URLs first.', 'warn'); return; }

    try { new URL(url1); } catch (e) { setStatus('Production URL is not valid.', 'fail'); return; }
    try { new URL(url2); } catch (e) { setStatus('Staging URL is not valid.', 'fail'); return; }

    setStatus('Opening windows…');
    openBtn.disabled = true;

    try {
      const sw = window.screen.availWidth;
      const sh = window.screen.availHeight;
      const hw = Math.floor(sw / 2);

      await Promise.all([
        chrome.windows.create({ url: url1, type: 'normal', left: 0,  top: 0, width: hw, height: sh }),
        chrome.windows.create({ url: url2, type: 'normal', left: hw, top: 0, width: hw, height: sh })
      ]);

      setStatus('Both windows opened side by side.', 'pass');
    } catch (e) {
      setStatus('Could not open windows: ' + (e.message || 'unknown error'), 'fail');
    }

    openBtn.disabled = false;
  });

  const obs = new MutationObserver(() => {
    if (panel.classList.contains('active') && prodInput && !prodInput.value) loadTrackedUrl();
  });
  obs.observe(panel, { attributes: true, attributeFilter: ['class'] });

  loadTrackedUrl();
})();
