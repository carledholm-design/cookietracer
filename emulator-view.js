// emulator-view.js — multi-device iframe preview with sync scroll + sync nav

'use strict';

let syncScroll = true;
let syncNav = true;

const frames = [];        // array of iframe elements
const frameUrls = new Map(); // iframe -> last known URL

// ── Init ────────────────────────────────────────────────────────────────

function init() {
  const v = chrome.runtime.getManifest().version;
  const vEl = document.getElementById('evVersion');
  if (vEl) vEl.textContent = v;

  chrome.storage.local.get('emulatorLaunchData', (result) => {
    const data = result.emulatorLaunchData;
    document.getElementById('evLoading')?.remove();

    if (!data?.devices?.length) {
      document.getElementById('evStage').innerHTML =
        '<div class="ev-empty">No devices selected.<br>Close this tab, open Cookie Tracer+ and add devices to the queue.</div>';
      return;
    }

    if (data.url) {
      const urlInput = document.getElementById('evUrlInput');
      if (urlInput) urlInput.value = data.url;
    }

    buildFrames(data);
  });

  setupControls();
  window.addEventListener('message', handleMessage);
}

// ── Build frames ────────────────────────────────────────────────────────

function buildFrames(data) {
  const stage = document.getElementById('evStage');
  stage.innerHTML = '';
  frames.length = 0;
  frameUrls.clear();

  data.devices.forEach((entry) => {
    const { device, isLandscape } = entry;
    const w = isLandscape ? device.h : device.w;
    const h = isLandscape ? device.w : device.h;

    const wrapper = document.createElement('div');
    wrapper.className = 'ev-frame';
    wrapper.style.width = w + 'px';

    const label = document.createElement('div');
    label.className = 'ev-frame-label';
    label.innerHTML = `
      <span class="ev-frame-name">${device.name}${isLandscape ? ' <span class="ev-rotated">⟳</span>' : ''}</span>
      <span class="ev-frame-dims">${w}&thinsp;×&thinsp;${h}</span>
    `;

    const iframe = document.createElement('iframe');
    iframe.className = 'ev-iframe';
    iframe.src = data.url || 'about:blank';
    iframe.title = device.name;

    wrapper.appendChild(label);
    wrapper.appendChild(iframe);
    stage.appendChild(wrapper);

    frames.push(iframe);
    frameUrls.set(iframe, data.url || '');
  });
}

// ── Message handler (sync scroll + nav from content script) ─────────────

function handleMessage(e) {
  const msg = e.data;
  if (!msg?.type?.startsWith('CT_EMULATOR_')) return;

  const sourceFrame = frames.find(f => {
    try { return f.contentWindow === e.source; } catch { return false; }
  });
  if (!sourceFrame) return;

  if (msg.type === 'CT_EMULATOR_SCROLL' && syncScroll) {
    frames.forEach(f => {
      if (f !== sourceFrame) {
        try {
          f.contentWindow?.postMessage(
            { type: 'CT_EMULATOR_SCROLL_TO', x: msg.x, y: msg.y }, '*'
          );
        } catch (_) {}
      }
    });
  }

  if (msg.type === 'CT_EMULATOR_NAV' && syncNav) {
    updateUrlBar(msg.url);
    frames.forEach(f => {
      if (f !== sourceFrame && frameUrls.get(f) !== msg.url) {
        frameUrls.set(f, msg.url);
        f.src = msg.url;
      }
    });
    frameUrls.set(sourceFrame, msg.url);
  }

  if (msg.type === 'CT_EMULATOR_LOADED') {
    frameUrls.set(sourceFrame, msg.url);
    updateUrlBar(msg.url);
  }
}

// ── URL bar ─────────────────────────────────────────────────────────────

function updateUrlBar(url) {
  const input = document.getElementById('evUrlInput');
  if (input && document.activeElement !== input) input.value = url;
}

function navigateAll(url) {
  if (!url) return;
  frames.forEach(f => {
    frameUrls.set(f, url);
    f.src = url;
  });
}

// ── Controls ─────────────────────────────────────────────────────────────

function setupControls() {
  const scrollBtn = document.getElementById('evSyncScroll');
  const navBtn    = document.getElementById('evSyncNav');
  const closeBtn  = document.getElementById('evClose');
  const urlInput  = document.getElementById('evUrlInput');
  const urlGo     = document.getElementById('evUrlGo');

  scrollBtn?.addEventListener('click', () => {
    syncScroll = !syncScroll;
    scrollBtn.classList.toggle('active', syncScroll);
    scrollBtn.setAttribute('aria-pressed', syncScroll);
  });

  navBtn?.addEventListener('click', () => {
    syncNav = !syncNav;
    navBtn.classList.toggle('active', syncNav);
    navBtn.setAttribute('aria-pressed', syncNav);
  });

  closeBtn?.addEventListener('click', () => window.close());

  urlGo?.addEventListener('click', () => navigateAll(urlInput?.value.trim()));
  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigateAll(urlInput.value.trim());
  });
}

document.addEventListener('DOMContentLoaded', init);
