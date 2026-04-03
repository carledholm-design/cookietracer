// emulator-overlay.js — content script
// Injects a full-screen multi-device iframe overlay into the pinned tab

'use strict';

let overlayHost = null;
let overlayIframes = [];
let syncScroll = true;
let syncNav = true;
const frameUrls = new Map();

// ── Public message listener ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'SHOW_EMULATOR') showEmulator(msg.devices, msg.url);
  if (msg?.type === 'HIDE_EMULATOR') removeOverlay();
});

// ── Remove ────────────────────────────────────────────────────────────

function removeOverlay() {
  if (overlayHost) {
    overlayHost.remove();
    overlayHost = null;
  }
  overlayIframes = [];
  frameUrls.clear();
  window.removeEventListener('message', handleSyncMessage);
}

// ── Build overlay ─────────────────────────────────────────────────────

function showEmulator(devices, url) {
  removeOverlay();

  const targetUrl = url || location.href;

  const host = document.createElement('div');
  host.id = '__ct_emulator_host__';
  Object.assign(host.style, {
    position: 'fixed',
    top: '0', left: '0',
    width: '100vw', height: '100vh',
    zIndex: '2147483647',
    contain: 'strict'
  });

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'root';
  root.innerHTML = `
    <header class="hdr">
      <div class="brand">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
          <rect x="7" y="7" width="6" height="10" rx="1"/>
        </svg>
        <span class="brand-name">Screen Emulator</span>
        <span class="brand-sub">Cookie Tracer+</span>
      </div>
      <div class="urlbar">
        <span class="url-lbl">URL</span>
        <input class="url-inp" id="urlInp" type="text" value="${esc(targetUrl)}" spellcheck="false" />
        <button class="url-go" id="urlGo" title="Navigate all frames">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </button>
      </div>
      <div class="ctrls">
        <button class="tog active" id="togScroll">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 3l4 4-4 4"/><path d="M21 7H9a4 4 0 0 0-4 4v1"/>
            <path d="M7 21l-4-4 4-4"/><path d="M3 17h12a4 4 0 0 0 4-4v-1"/>
          </svg>
          Sync Scroll
        </button>
        <button class="tog active" id="togNav">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
          </svg>
          Sync Nav
        </button>
        <div class="sep"></div>
        <button class="close-btn" id="closeBtn">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
          Close
        </button>
      </div>
    </header>
    <div class="stage" id="stage"></div>
  `;
  shadow.appendChild(root);
  document.documentElement.appendChild(host);
  overlayHost = host;

  // Build device frames
  const stage = shadow.getElementById('stage');
  devices.forEach(entry => {
    const { device, isLandscape } = entry;
    const w = isLandscape ? device.h : device.w;
    const h = isLandscape ? device.w : device.h;

    const frame = document.createElement('div');
    frame.className = 'frame';
    frame.style.width = w + 'px';

    const label = document.createElement('div');
    label.className = 'flabel';
    label.innerHTML = `
      <span class="fname">${device.name}${isLandscape ? ' <span class="frot">⟳</span>' : ''}</span>
      <span class="fdims">${w}\u202F\u00D7\u202F${h}</span>
    `;

    const iframe = document.createElement('iframe');
    iframe.className = 'fframe';
    iframe.src = targetUrl;
    iframe.title = device.name;

    frame.appendChild(label);
    frame.appendChild(iframe);
    stage.appendChild(frame);

    overlayIframes.push(iframe);
    frameUrls.set(iframe, targetUrl);
  });

  // Wire controls
  const togScroll = shadow.getElementById('togScroll');
  const togNav    = shadow.getElementById('togNav');
  const closeBtn  = shadow.getElementById('closeBtn');
  const urlInp    = shadow.getElementById('urlInp');
  const urlGo     = shadow.getElementById('urlGo');

  togScroll.addEventListener('click', () => {
    syncScroll = !syncScroll;
    togScroll.classList.toggle('active', syncScroll);
  });
  togNav.addEventListener('click', () => {
    syncNav = !syncNav;
    togNav.classList.toggle('active', syncNav);
  });
  closeBtn.addEventListener('click', removeOverlay);
  urlGo.addEventListener('click', () => navigateAll(urlInp.value.trim()));
  urlInp.addEventListener('keydown', e => { if (e.key === 'Enter') navigateAll(urlInp.value.trim()); });

  window.addEventListener('message', handleSyncMessage);
}

// ── Sync handler ──────────────────────────────────────────────────────

function handleSyncMessage(e) {
  const msg = e.data;
  if (!msg?.type?.startsWith('CT_EMULATOR_')) return;

  const src = overlayIframes.find(f => {
    try { return f.contentWindow === e.source; } catch { return false; }
  });
  if (!src) return;

  if (msg.type === 'CT_EMULATOR_SCROLL' && syncScroll) {
    overlayIframes.forEach(f => {
      if (f !== src) {
        try { f.contentWindow?.postMessage({ type: 'CT_EMULATOR_SCROLL_TO', x: msg.x, y: msg.y }, '*'); } catch {}
      }
    });
  }

  if (msg.type === 'CT_EMULATOR_NAV' && syncNav) {
    setUrlBar(msg.url);
    overlayIframes.forEach(f => {
      if (f !== src && frameUrls.get(f) !== msg.url) {
        frameUrls.set(f, msg.url);
        f.src = msg.url;
      }
    });
    frameUrls.set(src, msg.url);
  }

  if (msg.type === 'CT_EMULATOR_LOADED') {
    frameUrls.set(src, msg.url);
    setUrlBar(msg.url);
  }
}

function setUrlBar(url) {
  const inp = overlayHost?.shadowRoot?.getElementById('urlInp');
  if (inp && document.activeElement !== inp) inp.value = url;
}

function navigateAll(url) {
  if (!url) return;
  overlayIframes.forEach(f => { frameUrls.set(f, url); f.src = url; });
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Styles (shadow DOM — isolated from page CSS) ──────────────────────

const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
.root{display:flex;flex-direction:column;width:100vw;height:100vh;font-family:'Google Sans','Roboto',-apple-system,sans-serif;color:#e0e0e0;background:#0d1117}

/* Header */
.hdr{display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;background:#161b22;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0}
.brand{display:flex;align-items:center;gap:7px;flex-shrink:0;color:#7c9eff}
.brand-name{font-size:13px;font-weight:600;color:#e0e0e0;white-space:nowrap}
.brand-sub{font-size:11px;color:#666;white-space:nowrap}

/* URL bar */
.urlbar{display:flex;align-items:center;flex:1;min-width:0;height:30px;border:1.5px solid rgba(255,255,255,0.12);border-radius:7px;overflow:hidden;background:rgba(255,255,255,0.04)}
.url-lbl{padding:0 8px;font-size:9px;font-weight:700;color:#555;letter-spacing:.07em;text-transform:uppercase;border-right:1px solid rgba(255,255,255,0.08);height:100%;display:flex;align-items:center;flex-shrink:0}
.url-inp{flex:1;min-width:0;border:none;background:transparent;color:#ccc;font-size:12px;font-family:'Roboto Mono',monospace;padding:0 8px;outline:none;height:100%}
.url-inp:focus{background:rgba(124,158,255,0.06)}
.url-go{display:flex;align-items:center;justify-content:center;width:28px;height:100%;border:none;border-left:1px solid rgba(255,255,255,0.08);background:transparent;color:#7c9eff;cursor:pointer;transition:background .12s}
.url-go:hover{background:rgba(124,158,255,0.14)}

/* Controls */
.ctrls{display:flex;align-items:center;gap:6px;flex-shrink:0}
.tog{display:flex;align-items:center;gap:4px;padding:0 10px;height:28px;border-radius:6px;border:1.5px solid rgba(255,255,255,0.12);background:transparent;color:#666;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .12s;white-space:nowrap}
.tog:hover{color:#ccc;border-color:rgba(255,255,255,0.25)}
.tog.active{background:rgba(124,158,255,0.12);border-color:#7c9eff;color:#7c9eff}
.sep{width:1px;height:18px;background:rgba(255,255,255,0.1);flex-shrink:0}
.close-btn{display:flex;align-items:center;gap:4px;padding:0 10px;height:28px;border-radius:6px;border:1.5px solid rgba(255,255,255,0.12);background:transparent;color:#666;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:all .12s;white-space:nowrap}
.close-btn:hover{background:rgba(239,83,80,0.12);border-color:#ef5350;color:#ef5350}

/* Stage */
.stage{display:flex;flex-direction:row;align-items:flex-start;gap:10px;padding:10px;flex:1;overflow-x:auto;overflow-y:hidden;background:#0d1117}

/* Device frame */
.frame{display:flex;flex-direction:column;flex-shrink:0;height:100%;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);box-shadow:0 4px 24px rgba(0,0,0,0.5)}
.flabel{display:flex;align-items:center;justify-content:space-between;padding:5px 10px;background:#161b22;border-bottom:1px solid rgba(255,255,255,0.07);gap:8px;flex-shrink:0}
.fname{font-size:11px;font-weight:600;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frot{color:#7c9eff;font-size:10px}
.fdims{font-size:10px;font-weight:700;color:#7c9eff;white-space:nowrap;flex-shrink:0;font-variant-numeric:tabular-nums}
.fframe{flex:1;width:100%;border:none;display:block;background:#fff}

/* Force visible horizontal scrollbar on the stage */
.stage::-webkit-scrollbar{height:10px}
.stage::-webkit-scrollbar-track{background:rgba(255,255,255,0.04);border-radius:0}
.stage::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.22);border-radius:5px;border:2px solid #0d1117}
.stage::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.4)}
`;
