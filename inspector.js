// Cookie Tracer+ Inspector
// Version 1.9.2 - Enhanced error handling and stability

const __themeRoot = document.documentElement;

// Set version in subtitle from manifest
(function setVersion() {
  const v = chrome.runtime.getManifest().version;
  const el = document.getElementById('appVersion');
  if (el) el.textContent = 'v' + v;
})();

// Global error handler - suppress to keep console clean
window.addEventListener('error', (event) => {
  event.preventDefault(); // Prevent default error logging
});

window.addEventListener('unhandledrejection', (event) => {
  event.preventDefault(); // Prevent default rejection logging
});

function effectiveTheme(mode) {
  if (mode === "dark" || mode === "light") return mode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Always set an effective theme so the first click reliably flips the UI
chrome.storage.sync.get("appearance", ({ appearance }) => {
  const stored = appearance || "dark";
  __themeRoot.dataset.theme = effectiveTheme(stored);
});


// Banner blocker always resets to OFF when the panel opens — clean state every session
const _bannerBtn = document.getElementById("hideBannerToggle");
if (_bannerBtn) {
  _bannerBtn.setAttribute("aria-checked", "false");
  _bannerBtn.title = "Cookie Banner Blocker: Off";
}
chrome.storage.sync.remove("hideCookieBanner");
let __cookieValueCache = new Map();
let __lastNoticeKey = null;
let __sessionToken = 0; // Incremented on unpin — stale fetchReport calls abort


let __noticeOpen = false;
let __lastDismissedNoticeKey = null;
let __lastActiveJourney = null;
let __prevPresence = null;

// Global state
window.state = {
  trackedTabId: null,

  trackedUrl: "",
  trackedTitle: "",
  prevAssets: { js: [], css: [] },
  currentAssets: { js: [], css: [] }
};

// Local reference
const state = window.state;

const el = (id) => document.getElementById(id);

// Truncate a string in the middle, keeping start and end visible
function truncateMiddle(str, maxLen) {
  if (!str || str.length <= maxLen) return str;
  const half = Math.floor((maxLen - 3) / 2);
  return str.substring(0, half) + '...' + str.substring(str.length - half);
}

const conditionNotice = el("conditionNotice");
const conditionNoticeText = el("conditionNoticeText");

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ""; } };

function decodeBundle(url) {
  try {
    // Supports:
    // .../DependencyHandler.axd/<base64>/<js|css>
    // .../DependencyHandler.axd/<base64>/<number>/<js|css>
    const m = url.match(/DependencyHandler\.axd\/([^/]+)\/(?:\d+\/)?(js|css)/i);
    if (!m) return null;

    // URL-safe base64 -> standard base64, tolerate missing padding
    let b64url = (m[1] || "").trim();
    b64url = b64url.replace(/[^A-Za-z0-9\-_]/g, ""); // strip anything unexpected

    const std = b64url.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "===".slice((std.length + 3) % 4);

    let decoded;
    try {
      decoded = atob(std + pad);
    } catch {
      // Some bundles can be double-encoded; try a second pass
      const once = atob(std + pad);
      decoded = atob(once);
    }

    // Typical payload is ';' separated, but be tolerant
    return decoded.split(/[;\n,]+/).map(s => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}


function determineActiveJourney(cookies, url) {
  const u = (url || "").toLowerCase();
  if (u.includes("tardive-dyskinesia")) return "TD";
  if (u.includes("huntingtons-chorea")) return "HD";

  // Fallback: infer from cookies if URL doesn't contain a known slug.
  for (const c of (cookies || [])) {
    const n = (c.name || "").toLowerCase();
    if (n === "hdvisitorgroup" || n === "hdvistorgroup") return "HD";
    if (n === "visitorgroup" || n === "vistorgroup") return "TD";
  }
  return null;
}

function presenceFromCookies(cookies) {
  let td = false, hd = false;
  for (const c of (cookies || [])) {
    const n = (c.name || "").toLowerCase();
    if (n === "visitorgroup" || n === "vistorgroup") td = true;
    if (n === "hdvisitorgroup" || n === "hdvistorgroup") hd = true;
  }
  return { td, hd };
}




function resolveUrl(origin, p) {
  if (!p) return "";
  try { return new URL(p).href; } catch {}
  if (p.startsWith("/")) return origin + p;
  return origin + "/" + p;
}

function isFirstParty(pageHost, assetUrl) {
  const h = hostOf(assetUrl);
  return h === pageHost || h.endsWith("." + pageHost);
}


function flattenAssetKeys(list){
  const keys = [];
  (list || []).forEach(item => {
    if (!item) return;
    if (typeof item === "string") { keys.push(item); return; }
    if (item.parts && Array.isArray(item.parts)) {
      // include bundle url and each part for diffing
      keys.push(item.url);
      item.parts.forEach(p => keys.push(p));
    } else if (item.url) {
      keys.push(item.url);
    }
  });
  return keys;
}

function calculateDiff(prev, curr) {
  const p = new Set(prev);
  const c = new Set(curr);
  const added = curr.filter(x => !p.has(x));
  const removed = prev.filter(x => !c.has(x));
  let orderChanged = false;

  if (prev.length && curr.length && !added.length && !removed.length) {
    const min = Math.min(prev.length, curr.length);
    for (let i = 0; i < min; i++) {
      if (prev[i] !== curr[i]) { orderChanged = true; break; }
    }
  }
  return { added, removed, orderChanged };
}

async function fetchReport() {
  const myToken = __sessionToken;
  try {
    const t = await chrome.runtime.sendMessage({ type: "GET_TRACKED" });

    if (myToken !== __sessionToken) return; // Unpin fired during await — abort

    if (!t?.trackedTabId) {
      el("pageUrl").textContent = "&mdash;";
      el("timestamp").textContent = "Not tracking";
      return;
    }

    state.trackedTabId = t.trackedTabId;

    // Always prefer the tab's current URL (handles SPA navigation + ensures arrow/warning switch)
    let currentUrl = t.trackedUrl || "";
    try {
      const tab = await chrome.tabs.get(state.trackedTabId);
      if (tab?.url) currentUrl = tab.url;
    } catch (error) {
      // Tab no longer exists &mdash; clear tracked state
      state.trackedTabId = null;
      state.trackedUrl = null;
      el("pageUrl").textContent = "&mdash;";
      el("timestamp").textContent = "Tab closed";
      return;
    }

    if (myToken !== __sessionToken) return; // Unpin fired during await — abort

    state.trackedUrl = currentUrl;
    el("pageUrl").textContent = state.trackedUrl || "&mdash;";
    el("timestamp").textContent = new Date().toLocaleString();
    
    // Hide journey cookies empty state since we're now tracking
    const journeyEmpty = el("journeyCookiesEmpty");
    if (journeyEmpty) journeyEmpty.classList.add('hidden');
    const journeyWrap = el("journeyInjectWrap");
    if (journeyWrap) journeyWrap.classList.remove('hidden');

    // Condition arrow + warning are driven by URL slug
    const urlJourney = determineActiveJourney([], state.trackedUrl || "");
    if (__lastActiveJourney && urlJourney && __lastActiveJourney !== urlJourney) {
      showConditionNotice(__lastActiveJourney, urlJourney, `url:${__lastActiveJourney}->${urlJourney}`);
    }
    if (urlJourney) __lastActiveJourney = urlJourney;

    const rep = await chrome.runtime.sendMessage({
      type: "GET_TAB_REPORT",
      tabId: state.trackedTabId,
      url: state.trackedUrl
    });

    if (myToken !== __sessionToken) return; // Unpin fired during await — abort

    if (rep?.ok) renderCookies(rep.cookies || []);
    await updateAssets();
  } catch (error) {
    // Silently handle - expected when no tab is pinned
  }
}
async function updateAssets() {
  if (!state.trackedTabId) return;
  try {
    let assets = { scripts: [], styles: [], href: state.trackedUrl };
    
    try {
      assets = await chrome.tabs.sendMessage(state.trackedTabId, { type: "COLLECT_ASSETS" });
    } catch {
      // Content script not active - skip silently
      return;
    }
    
    const origin = (() => { try { return new URL(state.trackedUrl).origin; } catch { return ""; } })();
    const pageHost = hostOf(state.trackedUrl);

    const processedJs = processAssetList((assets.scripts || []), origin);
    const processedCss = processAssetList((assets.styles || []), origin);

    state.prevAssets = state.currentAssets;
    state.currentAssets = { js: processedJs, css: processedCss };

    const jsDiff = calculateDiff(flattenAssetKeys(state.prevAssets.js), flattenAssetKeys(processedJs));
    const cssDiff = calculateDiff(flattenAssetKeys(state.prevAssets.css), flattenAssetKeys(processedCss));

  } catch {
    // Silently handle
  }
}

function processAssetList(rawList, origin) {
  const out = [];
  const seen = new Set();

  for (const item of (rawList || [])) {
    if (!item) continue;
    
    // Handle both old format (string) and new format (object with timestamp)
    const url = typeof item === 'string' ? item : item.url;
    const lastModified = typeof item === 'object' ? item.lastModified : null;
    
    if (!url) continue;

    const parts = decodeBundle(url);
    if (parts && parts.length) {
      const key = "bundle:" + url;
      if (seen.has(key)) continue;
      seen.add(key);

      const resolvedParts = parts.map(p => resolveUrl(origin || "", p)).filter(Boolean);
      out.push({ kind: "bundle", url, parts: resolvedParts, lastModified });
      // Also de-dupe parts if they appear as standalone URLs later
      resolvedParts.forEach(pu => seen.add("file:" + pu));
    } else {
      const key = "file:" + url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "file", url, lastModified });
    }
  }
  return out;
}

function flattenAssetUrls(items) {
  const flat = [];
  for (const it of (items || [])) {
    if (!it) continue;
    if (typeof it === "string") { flat.push(it); continue; }
    if (it.kind === "bundle") {
      flat.push(it.url);
      (it.parts || []).forEach(p => flat.push(p));
    } else if (it.url) {
      flat.push(it.url);
    }
  }
  return [...new Set(flat)];
}

function showConditionNotice(from, to, key) {
  // Don't fire during dropdown-triggered cookie changes
  if (window.__dropdownInjecting) return;

  // Normalize values to simple labels
  const norm = (v) => {
    const s = (v == null) ? "" : String(v);
    if (/^td$/i.test(s) || /tardive/i.test(s)) return "TD";
    if (/^hd$/i.test(s) || /huntington/i.test(s)) return "HD";
    return null; // Changed from "Unknown" to null
  };

  const fromLabel = norm(from);
  const toLabel = norm(to);
  
  // Don't show notice if either side is unknown/null
  if (!fromLabel || !toLabel) return;
  
  // Don't show if they're the same
  if (fromLabel === toLabel) return;
  
  const k = key || `switch:${fromLabel}->${toLabel}`;

  // Don't spam the same notice while it's open
  if (__noticeOpen && __lastNoticeKey === k) return;

  __noticeOpen = true;
  __lastNoticeKey = k;

  const notice = el("conditionNotice");
  const text = el("conditionNoticeText");
  const close = el("conditionNoticeClose");
  if (!notice || !text || !close) return;

  text.innerHTML = `Condition has switched from <b>${fromLabel}</b> to <b>${toLabel}</b>.`;
  notice.classList.remove("hidden");
  notice.setAttribute("aria-hidden", "false");

  // retrigger animation
  notice.classList.remove("show");
  void notice.offsetWidth;
  requestAnimationFrame(() => notice.classList.add("show"));

  // One-time close binding
  if (!close.__bound) {
    close.__bound = true;
    close.addEventListener("click", () => {
      __noticeOpen = false;
      notice.classList.remove("show");
      notice.classList.add("hidden");
      notice.setAttribute("aria-hidden", "true");
    });
  }
}


function maybeShowSwitchNotice(prevPresence, currPresence) {
  // Returns {from, to} if a cross-journey switch is detected, else null
  if (!prevPresence || !currPresence) return null;
  
  const { td: prevTd, hd: prevHd } = prevPresence;
  const { td: currTd, hd: currHd } = currPresence;
  
  // Detect if we gained the opposite journey cookie
  if (prevTd && !prevHd && currHd) {
    return { from: "TD", to: "HD" };
  }
  if (prevHd && !prevTd && currTd) {
    return { from: "HD", to: "TD" };
  }
  
  return null;
}


function hideConditionNotice() {
  __noticeOpen = false;
  if (!conditionNotice) return;
  conditionNotice.classList.add("hidden");
  conditionNotice.classList.remove("show");
  conditionNotice.setAttribute("aria-hidden", "true");
}


function flattenAssetEntries(entries){
  const out = [];
  (entries || []).forEach(e => {
    if (!e) return;
    if (typeof e === "string") { out.push(e); return; }
    if (e.url) out.push(e.url);
    if (Array.isArray(e.parts)) e.parts.forEach(u => out.push(u));
  });
  return [...new Set(out.filter(Boolean))];
}

function renderCookies(cookies) {
  const hdValueEl = el("journeyCookieHD");
  const tdValueEl = el("journeyCookieTD");

  const visitors = (cookies || []).filter(c => /visitor/i.test(c.name) || /vistor/i.test(c.name));
  const tdCookies = visitors.filter(c => /^(VisitorGroup|VistorGroup)$/i.test(c.name));
  const hdCookies = visitors.filter(c => /^(HdVisitorGroup|HdVistorGroup|HDVistorGroup)$/i.test(c.name));

  const pickOne = (group) => {
    if (!group.length) return null;
    return group.find(c => c.value) || group[0];
  };

  const hdCookie = pickOne(hdCookies);
  const tdCookie = pickOne(tdCookies);
  const deduped = [hdCookie, tdCookie].filter(Boolean);

  const activeJourney = determineActiveJourney([], state.trackedUrl || "");
  if (__lastActiveJourney && activeJourney && __lastActiveJourney !== activeJourney) {
    showConditionNotice(__lastActiveJourney, activeJourney);
  }
  if (activeJourney) __lastActiveJourney = activeJourney;

  // Active condition block highlighting — based on which condition page is loaded
  const hdGroup = el('journeyGroupHD');
  const tdGroup = el('journeyGroupTD');
  if (hdGroup && tdGroup) {
    hdGroup.classList.remove('active-hd', 'active-td', 'inactive');
    tdGroup.classList.remove('active-hd', 'active-td', 'inactive');
    if (state.trackedUrl && activeJourney === 'HD') {
      hdGroup.classList.add('active-hd');
      tdGroup.classList.add('inactive');
    } else if (state.trackedUrl && activeJourney === 'TD') {
      tdGroup.classList.add('active-td');
      hdGroup.classList.add('inactive');
    }
  }

  const pres = presenceFromCookies(deduped);
  const sw = maybeShowSwitchNotice(__prevPresence, pres);
  if (sw) showConditionNotice(sw.from, sw.to);
  __prevPresence = pres;

  // Update HD display
  if (hdValueEl) {
    const raw = hdCookie?.value || 'unknown';
    hdValueEl.textContent = raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // Update TD display
  if (tdValueEl) {
    const raw = tdCookie?.value || 'unknown';
    tdValueEl.textContent = raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  // Sync dropdowns
  syncJourneyDropdowns(cookies);

  __cookieValueCache = new Map();
  deduped.forEach(({ name, value, domain, path }) => {
    __cookieValueCache.set(`${name}|${domain || ""}|${path || ""}`, value ?? "");
  });
}

function showToast(msg, type = 'info', persistent = false, actionButton = null) {
  // Type can be: 'info', 'success', 'warning', 'error'
  // If second param is boolean (old API), treat as persistent
  if (typeof type === 'boolean') {
    persistent = type;
    type = 'warning';
  }
  
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  // SVG circle icons matching the screenshot style
  const icons = {
    success: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 16 9" stroke-width="2"/></svg>`,
    info:    `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><circle cx="12" cy="8" r="0.5" fill="currentColor" stroke="none"/></svg>`,
    warning: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="13"/><circle cx="12" cy="16" r="0.5" fill="currentColor" stroke="none"/></svg>`,
    error:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
  };
  
  const labels = { info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' };
  
  const toast = document.createElement('div');
  toast.className = persistent ? 'toast persistent' : 'toast';
  toast.setAttribute('data-type', type);
  toast.setAttribute('aria-hidden', 'false');
  
  let html = `
    <div class="toastIcon">${icons[type] || icons.info}</div>
    <div class="toastContent">
      <div class="toastLabel">${labels[type] || 'Info'}</div>
      <div class="toastMessage">${msg}</div>
    </div>
  `;
  
  if (actionButton) {
    html += `<button class="toastAction">${actionButton.label}</button>`;
  }
  
  html += `<button class="toastClose" aria-label="Close">&times;</button>`;
  
  if (!persistent) {
    html += `<div class="toastProgress"></div>`;
  }
  
  toast.innerHTML = html;
  container.appendChild(toast);
  
  // Trigger reflow then animate in
  void toast.offsetWidth;
  requestAnimationFrame(() => {
    toast.classList.add('show');
    if (!persistent) {
      const progressBar = toast.querySelector('.toastProgress');
      if (progressBar) {
        requestAnimationFrame(() => progressBar.classList.add('animate'));
      }
    }
  });
  
  // Close button
  const closeBtn = toast.querySelector('.toastClose');
  if (closeBtn) {
    closeBtn.onclick = () => removeToast(toast);
  }
  
  // Action button
  if (actionButton && actionButton.onClick) {
    const actionBtn = toast.querySelector('.toastAction');
    if (actionBtn) actionBtn.onclick = actionButton.onClick;
  }
  
  // Auto-dismiss after 5 seconds
  if (!persistent) {
    setTimeout(() => removeToast(toast), 3000);
  }
}

function removeToast(toast) {
  toast.classList.remove('show');
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 400); // Match transition duration
}


const noticeCloseBtn = document.getElementById("conditionNoticeClose");
if (noticeCloseBtn) {
  noticeCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideConditionNotice();
  });
}

// Persist disclosure open/close state
// REMOVED: Dependencies section no longer exists
/*
["jsToggle", "cssToggle"].forEach(id => {
  const btn = el(id);
  const target = el(id === "jsToggle" ? "summaryJS" : "summaryCSS");

  chrome.storage.session.get(id, (res) => {
    if (res[id]) {
      btn.setAttribute("aria-expanded", "true");
      target.classList.remove("hidden");
    }
  });

  btn.addEventListener("click", () => {
    const isExpanded = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!isExpanded));
    target.classList.toggle("hidden", isExpanded);
    chrome.storage.session.set({ [id]: !isExpanded });
  });
});
*/

// Theme button
const themeToggleBtn = el("themeToggleBtn");
if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", async () => {
    const current = __themeRoot.dataset.theme || effectiveTheme("system");
    const mode = current === "dark" ? "light" : "dark";
    __themeRoot.dataset.theme = mode;
    await chrome.storage.sync.set({ appearance: mode });
    showToast(mode === "dark" ? "Dark mode" : "Light mode", 'info');
  });
}


// Cookie Banner Blocker toggle
const hideBannerBtn = el("hideBannerToggle");
if (hideBannerBtn) {
  hideBannerBtn.addEventListener("click", async () => {
    const current = hideBannerBtn.getAttribute("aria-checked") === "true";
    const next = !current;
    hideBannerBtn.setAttribute("aria-checked", next ? "true" : "false");
    hideBannerBtn.title = next ? "Cookie Banner Blocker: On" : "Cookie Banner Blocker: Off";
    // Save to storage so banner-blocker.js can re-apply the class after page reloads
    await chrome.storage.sync.set({ hideCookieBanner: next });
    // Immediately apply on the pinned tab via class toggle
    if (state.trackedTabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: state.trackedTabId },
          func: (enable) => {
            if (enable) {
              document.documentElement.classList.add("ct-hide-banners");
            } else {
              document.documentElement.classList.remove("ct-hide-banners");
            }
          },
          args: [next]
        });
      } catch {}
    }
    showToast(next ? "Cookie Banner Blocker enabled" : "Cookie Banner Blocker disabled", 'success');
  });
}

// Pin current tab button - finds ANY web tab across all windows
el("pinTab").addEventListener("click", async () => {
  const pinBtn = el("pinTab");
  
  // If already pinned, show confirmation modal
  if (pinBtn.classList.contains('pinned')) {
    showUnpinModal();
    return;
  }
  
  // Otherwise, pin a tab
  try {
    // Get the inspector's own window (it's a popup type, but be safe)
    const inspectorWin = await chrome.windows.getCurrent();
    const inspectorWindowId = inspectorWin.id;

    // Get all normal browser windows except the inspector
    const allWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
    const otherWindows = allWindows.filter(w => w.id !== inspectorWindowId);

    if (otherWindows.length === 0) {
      showToast('No browser windows found', 'warning');
      return;
    }

    // Collect all active web tabs from non-inspector windows
    // Sort by lastAccessed so the most recently used active tab wins
    const activeTabs = otherWindows
      .flatMap(w => w.tabs.filter(t => t.active))
      .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('chrome-extension://'))
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

    const targetTab = activeTabs[0] || null;

    if (!targetTab) {
      showToast('No web page tabs found', 'warning');
      return;
    }

    await pinToTab(targetTab, pinBtn);

  } catch (error) {
    // Only show error if pin button is still not pinned — means it genuinely failed
    if (!el("pinTab").classList.contains("pinned")) {
      showToast("Could not find a tab to pin", "warning");
    }
  }
});

// Show unpin confirmation modal
function showUnpinModal() {
  const modal = el("unpinModal");
  if (!modal.classList.contains('hidden')) return; // already open

  const messageEl = el("unpinModalMessage");
  const scanProgress = document.querySelector('.scanProgress');
  const isScanRunning = scanProgress && !scanProgress.parentElement.classList.contains('hidden');
  messageEl.textContent = isScanRunning
    ? "This will stop the active scan and clear current session data."
    : "This will clear current session data.";

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

// Hide unpin modal
function hideUnpinModal() {
  const modal = el("unpinModal");
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

// Handle unpin confirmation
async function handleUnpin() {
  try {
    // Invalidate any in-flight fetchReport calls
    __sessionToken++;

    // Hide modal immediately — don't wait for async work
    hideUnpinModal();

    // Capture tabId before clearing state
    const prevTabId = state.trackedTabId;

    // Reset banner blocker button immediately
    const bannerBtn = el("hideBannerToggle");
    if (bannerBtn) {
      bannerBtn.setAttribute("aria-checked", "false");
      bannerBtn.title = "Cookie Banner Blocker: Off";
    }
    chrome.storage.sync.set({ hideCookieBanner: false }).catch(() => {});

    const pinBtn = el("pinTab");
    
    // Clear state
    state.trackedUrl = null;
    state.trackedTabId = null;
    state.trackedTitle = null;
    
    // Update UI - pin button
    pinBtn.classList.remove('pinned');
    
    // Update text displays
    el("pageUrl").innerHTML = 'Click the <svg width="16" height="16" viewBox="0 0 24 24" style="display: inline; vertical-align: middle; margin: 0 2px;"><use href="#icon-pin"></use></svg> icon to track website tab';
    el("timestamp").textContent = "No tab pinned yet";
    
    // Show journey cookies empty state
    const journeyEmpty = el("journeyCookiesEmpty");
    if (journeyEmpty) journeyEmpty.classList.remove('hidden');
    const journeyWrap = el("journeyInjectWrap");
    if (journeyWrap) journeyWrap.classList.add('hidden');
    
    // Update pinned indicator
    const indicator = el("pinnedIndicator");
    const domainEl = el("pinnedDomain");
    if (indicator && domainEl) {
      indicator.classList.add('unpinned');
      domainEl.textContent = "No site pinned";
    }
    
    // Clear data displays
    el("summaryCookies").innerHTML = '<div class="emptyState">No Cookies Found</div>';

    // Reset journey displays
    __lastActiveJourney = null;
    __prevPresence = null;
    const hdVal = el('journeyCookieHD'); if (hdVal) hdVal.textContent = 'Unknown';
    const tdVal = el('journeyCookieTD'); if (tdVal) tdVal.textContent = 'Unknown';
    const hdSel = el('journeySelectHD'); if (hdSel) hdSel.value = 'unknown';
    const tdSel = el('journeySelectTD'); if (tdSel) tdSel.value = 'unknown';
    const hdGrp = el('journeyGroupHD'); if (hdGrp) hdGrp.className = 'journey-inject-group';
    const tdGrp = el('journeyGroupTD'); if (tdGrp) tdGrp.className = 'journey-inject-group';
    const jStatus = el('journeyInjectStatus'); if (jStatus) jStatus.textContent = '';

    // Clear background session
    await chrome.storage.session.remove(['trackedTabId', 'trackedUrl', 'trackedTitle', 'trackedWindowId']).catch(() => {});

    // Remove banner blocker from the page
    if (prevTabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: prevTabId },
          func: () => document.documentElement.classList.remove("ct-hide-banners")
        });
      } catch {}
    }

    // Show success alert
    showToast('Unpinned successfully', 'success');
  } catch (e) {
    // If anything fails, still ensure UI is reset
    const pinBtn = el("pinTab");
    if (pinBtn) pinBtn.classList.remove('pinned');
    hideUnpinModal();
    console.warn('[Cookie Tracer+] Unpin cleanup error:', e);
    showToast('Unpinned successfully', 'success');
  }
}

// Modal button handlers
el("unpinCancel").addEventListener("click", () => {
  hideUnpinModal();
});

el("unpinModalClose")?.addEventListener("click", () => {
  hideUnpinModal();
});

let __unpinInProgress = false;
el("unpinConfirm").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (__unpinInProgress) return;
  __unpinInProgress = true;
  try {
    await handleUnpin();
  } catch (e) {
    // Ensure unpin completes even if something throws
    hideUnpinModal();
    console.warn('[Cookie Tracer+] Unpin handler error:', e);
    showToast('Unpinned successfully', 'success');
  } finally {
    __unpinInProgress = false;
  }
});

// Close modal only on overlay click
el("unpinModal").addEventListener("click", (e) => {
  if (e.target.classList.contains('modalOverlay')) {
    hideUnpinModal();
  }
});

// Helper function to pin to a specific tab
async function pinToTab(tab, pinBtn) {
  // FORCE update tracking to this tab
  await chrome.runtime.sendMessage({
    type: 'TRACK_THIS_TAB',
    tabId: tab.id,
    url: tab.url,
    title: tab.title
  });

  // Always remove stale banner blocker class from previous session
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.classList.remove("ct-hide-banners")
    });
  } catch {}

  // Always reset banner blocker button to OFF on pin
  const bannerBtnPin = el("hideBannerToggle");
  if (bannerBtnPin) {
    bannerBtnPin.setAttribute("aria-checked", "false");
    bannerBtnPin.title = "Cookie Banner Blocker: Off";
  }
  await chrome.storage.sync.set({ hideCookieBanner: false }).catch(() => {});

  // Update local state
  state.trackedUrl = tab.url;
  state.trackedTabId = tab.id;
  state.trackedTitle = tab.title;
  
  // Visual feedback - pin button
  pinBtn.classList.add('pinned');
  
  // Update pinned indicator &mdash; show tab title, fall back to hostname
  const indicator = el("pinnedIndicator");
  const domainEl = el("pinnedDomain");
  if (indicator && domainEl) {
    indicator.classList.remove('unpinned');
    domainEl.textContent = tab.title || hostOf(tab.url);
  }
  
  // Show toast
  const domain = hostOf(tab.url);
  showToast(`Pinned: ${tab.title || domain}`, 'success');
  
  // Ensure content script is injected
  let contentScriptReady = false;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    contentScriptReady = true;
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 200));
      contentScriptReady = true;
    } catch (injectError) {
      showToast('Could not inject content script', 'error');
    }
  }
  
  // Wait for background to capture cookies
  await new Promise(r => setTimeout(r, 800));
  
  // Refresh data - cookies AND assets
  await fetchReport();
  
}

// Refresh tracked tab (hard reload)
// Clear cache/cookies for ONLY this tracked tab, then reload (broom does both)
el("clearPage").addEventListener("click", async () => {
  if (!state.trackedTabId) {
    showToast("No tab pinned to clear", 'warning');
    return;
  }
  showToast("Clearing Tab Data...", 'info');

  // Get the current tab URL
  try {
    const tab = await chrome.tabs.get(state.trackedTabId);
    if (tab?.url) {
      state.trackedUrl = tab.url;
      el("pageUrl").textContent = state.trackedUrl;
    }
  } catch {}

  if (!state.trackedUrl) return;

  const url = state.trackedUrl;
  const domain = new URL(url).hostname;
  const scheme = url.startsWith('https') ? 'https://' : 'http://';

  // Clear journey cookies directly — both conditions, both spellings
  const cookieNames = ['HdVisitorGroup', 'HdVistorGroup', 'VisitorGroup', 'VistorGroup'];
  await Promise.allSettled(
    cookieNames.map(name => chrome.cookies.remove({ url: `${scheme}${domain}/`, name }))
  );

  // Also tell background to clear its tracked cookies
  chrome.runtime.sendMessage({ 
    type: "CLEAR_TAB_COOKIES", 
    tabId: state.trackedTabId,
    url
  }).catch(() => {});

  // Clear localStorage on the page
  try {
    await chrome.scripting.executeScript({
      target: { tabId: state.trackedTabId },
      func: () => localStorage.clear()
    });
  } catch {}

  // Reload with cache bypass
  try {
    await chrome.tabs.reload(state.trackedTabId, { bypassCache: true });
    showToast("Cleared & reloaded!", 'success');
    document.querySelectorAll('.journey-btn').forEach(b => b.classList.remove('journey-btn--active'));
    const journeyStatus = document.getElementById('journeyInjectStatus');
    if (journeyStatus) journeyStatus.textContent = '';
    setTimeout(() => fetchReport(), 1800);
  } catch (error) {
    showToast("Cleared but reload failed", 'warning');
  }
});

// Refresh on navigation
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "NAVIGATION" && state.trackedTabId) {
    fetchReport().catch(() => {});
  }
});

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;
    
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    const target = document.getElementById(`content-${targetTab}`);
    if (target) target.classList.add('active');
  });
});

// Initialize on load — check if a tab is already tracked and restore state
let initAttempts = 0;
const maxInitAttempts = 5;

async function tryInitialize() {
  const t = await chrome.runtime.sendMessage({ type: "GET_TRACKED" });
  if (t?.trackedTabId) {
    // Verify the tab still exists AND is a valid web page
    try {
      const tab = await chrome.tabs.get(t.trackedTabId);
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) throw new Error("gone");
    } catch {
      // Tab gone or no longer a web page — clear stale session
      await chrome.storage.session.remove(['trackedTabId', 'trackedUrl', 'trackedTitle', 'trackedWindowId']).catch(() => {});
      return;
    }

    // Tab is alive — restore pin button visual state
    const pinBtn = el("pinTab");
    if (pinBtn) pinBtn.classList.add('pinned');

    // Restore pinned indicator
    const indicator = el("pinnedIndicator");
    const domainEl = el("pinnedDomain");
    if (indicator && domainEl) {
      indicator.classList.remove('unpinned');
      domainEl.textContent = t.trackedTitle || hostOf(t.trackedUrl || "") || "Tracking";
    }

    // Hide empty state, show journey blocks
    const journeyEmpty = el("journeyCookiesEmpty");
    if (journeyEmpty) journeyEmpty.classList.add('hidden');
    const journeyWrap = el("journeyInjectWrap");
    if (journeyWrap) journeyWrap.classList.remove('hidden');

    await fetchReport();
  } else if (initAttempts < maxInitAttempts) {
    initAttempts++;
    setTimeout(tryInitialize, 300);
  }
}

tryInitialize();


// ==================== DEV TOOLS: FONT CHECKER ====================

el("scanFontsBtn")?.addEventListener("click", async () => {
  if (!state.trackedTabId || !state.trackedUrl) {
    showToast("No tab pinned", 'warning');
    return;
  }
  showToast("Scanning fonts across site...", 'info');

  const resultsContainer = el("fontCheckerResults");
  const progressContainer = el("fontScanProgress");
  const detailsEl = el("fontScanDetails");
  const summaryEl = el("fontConsistencySummary");
  const familiesEl = el("fontFamiliesList");

  resultsContainer.classList.remove("hidden");
  progressContainer.classList.remove("hidden");
  summaryEl.classList.add("hidden");

  try {
    // Crawl pages
    const pages = await crawlSitePages(detailsEl);

    // For each page, we need to extract fonts from the LIVE rendered page
    // We can only do this on the pinned tab, so we navigate to each page
    // Instead: parse CSS from HTML for font-family declarations + check live page
    const fontData = {}; // family -> { conditions: { SPLITTER: [...], HD: [...], TD: [...] } }

    // First: scan the live pinned page
    const liveFonts = await scanPageFonts(state.trackedTabId);
    const liveCondition = detectConditionFromUrl(state.trackedUrl) || 'SPLITTER';
    mergeFontData(fontData, liveFonts, liveCondition, state.trackedUrl);

    // For other pages: extract from CSS in HTML (can't render them)
    let scanned = 1;
    for (const page of pages) {
      if (page.url === state.trackedUrl) continue;
      detailsEl.textContent = `Scanned ${++scanned}/${pages.length} pages`;
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(page.html, 'text/html');
      
      // Extract inline styles and style tags for font info
      const cssTexts = [];
      doc.querySelectorAll('style').forEach(s => cssTexts.push(s.textContent));
      doc.querySelectorAll('[style]').forEach(el => cssTexts.push(el.getAttribute('style')));
      
      // Also extract from link[rel=stylesheet] if we fetched them
      // For now, extract font-family mentions from the page HTML
      const bodyText = doc.body ? doc.body.innerHTML : '';
      
      // Parse font-family from CSS
      const fontFamilyRegex = /font-family\s*:\s*([^;}"]+)/gi;
      const foundFamilies = new Set();
      cssTexts.concat([bodyText]).forEach(text => {
        let match;
        while ((match = fontFamilyRegex.exec(text)) !== null) {
          const families = match[1].split(',').map(f => f.trim().replace(/["']/g, ''));
          families.forEach(f => { if (f && !f.includes('inherit') && !f.includes('initial')) foundFamilies.add(f); });
        }
      });

      foundFamilies.forEach(family => {
        if (!fontData[family]) fontData[family] = { conditions: { SPLITTER: [], HD: [], TD: [] } };
        if (!fontData[family].conditions[page.condition]) fontData[family].conditions[page.condition] = [];
        // Mark as found on this page (no detailed size/weight since we can't render)
        const pageTitle = doc.title || new URL(page.url).pathname;
        const existing = fontData[family].conditions[page.condition].find(u => u.page === pageTitle);
        if (!existing) {
          fontData[family].conditions[page.condition].push({ page: pageTitle, fromCSS: true });
        }
      });
    }

    // Render results
    progressContainer.classList.add("hidden");
    renderFontResults(fontData, familiesEl, summaryEl);
    
    const familyCount = Object.keys(fontData).length;
    showToast(`Scanned ${pages.length} pages &mdash; found ${familyCount} font families`, 'success');
    document.dispatchEvent(new CustomEvent('fontScanComplete', {
      detail: { families: familyCount }
    }));
  } catch (error) {
    showToast("Font scan failed: " + error.message, 'error');
  }
});

async function scanPageFonts(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const fontMap = {};
      document.querySelectorAll('body *').forEach(el => {
        if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
        const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
        if (!hasText) return;

        const cs = getComputedStyle(el);
        const family = cs.fontFamily.replace(/["']/g, '').split(',')[0].trim();
        const size = cs.fontSize;
        const weight = cs.fontWeight;
        const color = cs.color;
        const sample = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').substring(0, 50);
        if (!sample) return;

        const tag = el.tagName.toLowerCase();

        if (!fontMap[family]) fontMap[family] = [];
        fontMap[family].push({ size, weight, color, sample, element: tag });
      });
      return fontMap;
    }
  });
  return result.result || {};
}

function mergeFontData(fontData, liveFonts, condition, pageUrl) {
  let pageTitle;
  try { pageTitle = new URL(pageUrl).pathname; } catch { pageTitle = pageUrl; }

  for (const [family, usages] of Object.entries(liveFonts)) {
    if (!fontData[family]) fontData[family] = { conditions: { SPLITTER: [], HD: [], TD: [] } };
    if (!fontData[family].conditions[condition]) fontData[family].conditions[condition] = [];

    // Deduplicate by size+weight+color
    const unique = {};
    usages.forEach(u => {
      const key = `${u.size}|${u.weight}|${u.color}`;
      if (!unique[key]) unique[key] = { ...u, count: 1, page: pageTitle };
      else unique[key].count++;
    });

    Object.values(unique).forEach(u => {
      fontData[family].conditions[condition].push(u);
    });
  }
}

function renderFontResults(fontData, familiesEl, summaryEl) {
  const families = Object.keys(fontData).sort();
  
  if (families.length === 0) {
    familiesEl.innerHTML = '<div class="emptyState">No fonts detected</div>';
    return;
  }

  // Consistency check
  const consistencyIssues = [];
  families.forEach(family => {
    const conds = fontData[family].conditions;
    const hdSizes = new Set((conds.HD || []).filter(u => u.size).map(u => u.size));
    const tdSizes = new Set((conds.TD || []).filter(u => u.size).map(u => u.size));
    
    if (hdSizes.size > 0 && tdSizes.size > 0) {
      const hdArr = [...hdSizes].sort();
      const tdArr = [...tdSizes].sort();
      if (JSON.stringify(hdArr) !== JSON.stringify(tdArr)) {
        consistencyIssues.push({ family, hd: hdArr, td: tdArr });
      }
    }
  });

  // Render consistency summary
  if (consistencyIssues.length > 0) {
    let sumHtml = '<div class="consistencySummary">';
    sumHtml += '<div class="consistencyHeader sectionHeader" style="font-size:11px;padding:8px 0 4px;">âš ï¸ Font Inconsistencies</div>';
    consistencyIssues.forEach(issue => {
      sumHtml += `<div class="consistencyItem">
        <span class="consistencyFont">${issue.family}</span>
        <span class="consistencyDetail">HD: ${issue.hd.join(', ')} ↑ TD: ${issue.td.join(', ')}</span>
      </div>`;
    });
    sumHtml += '</div>';
    summaryEl.innerHTML = sumHtml;
    summaryEl.classList.remove("hidden");
  } else {
    summaryEl.innerHTML = '<div class="consistencySummary"><div class="consistencyHeader sectionHeader" style="font-size:11px;padding:8px 0 4px;">âœ" Fonts consistent across conditions</div></div>';
    summaryEl.classList.remove("hidden");
  }

  // Render font families
  let html = '';
  families.forEach((family, idx) => {
    const data = fontData[family];
    const allUsages = [...(data.conditions.SPLITTER || []), ...(data.conditions.HD || []), ...(data.conditions.TD || [])];
    const usageCount = allUsages.length;
    const conditionLabels = [];
    if ((data.conditions.SPLITTER || []).length > 0) conditionLabels.push('SPLITTER');
    if ((data.conditions.HD || []).length > 0) conditionLabels.push('HD');
    if ((data.conditions.TD || []).length > 0) conditionLabels.push('TD');

    const toggleId = `fontToggle${idx}`;
    const listId = `fontList${idx}`;

    // Check if this font has consistency issues
    const hasIssue = consistencyIssues.some(i => i.family === family);
    const iconColor = hasIssue ? 'var(--orange)' : 'var(--accent)';

    html += `
      <button class="disclosure fontDisclosure" id="${toggleId}" aria-expanded="false">
        <span class="disclabel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:${iconColor};margin-right:8px;">
            <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
          </svg>
          ${family}
        </span>
        <span class="discmeta">
          <span>${conditionLabels.join(' Â· ')}</span>
          <span class="chev">▸</span>
        </span>
      </button>
      <div class="divider"></div>
      <div id="${listId}" class="linkTableContainer hidden">`;

    // Sub-tables per condition
    ['SPLITTER', 'HD', 'TD'].forEach(cond => {
      const usages = data.conditions[cond] || [];
      if (usages.length === 0) return;

      // Filter to rendered usages (have size/weight)
      const rendered = usages.filter(u => u.size);
      const cssOnly = usages.filter(u => u.fromCSS);

      html += `<div class="fontCondLabel">${cond}</div>`;

      if (rendered.length > 0) {
        html += '<table class="linkTable fontTable"><thead><tr><th>Size</th><th>Weight</th><th>Colors</th><th>Example</th></tr></thead><tbody>';
        rendered.forEach(u => {
          const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${u.color};border:1px solid var(--border);vertical-align:middle;margin-right:4px;"></span>`;
          html += `<tr>
            <td>${u.size}</td>
            <td>${u.weight}</td>
            <td>${swatch}${u.color}</td>
            <td title="${u.element}" class="linkUrl">${(u.sample || '').substring(0, 25)}${(u.sample || '').length > 25 ? '...' : ''}</td>
          </tr>`;
        });
        html += '</tbody></table>';
      }

      if (cssOnly.length > 0 && rendered.length === 0) {
        html += `<div class="fontCssNote">Referenced in CSS on ${cssOnly.length} page${cssOnly.length !== 1 ? 's' : ''}</div>`;
      }
    });

    html += '</div>';
  });

  familiesEl.innerHTML = html;

  // Bind dynamic toggles
  families.forEach((_, idx) => {
    setupDisclosureToggle(`fontToggle${idx}`, `fontList${idx}`);
  });
}



// ─── Clear Buttons ────────────────────────────────────────────────────────────

el("clearFontsBtn")?.addEventListener("click", () => {
  const results = el("fontCheckerResults");
  const scanBtn = el("fontsScanButton");
  if (results) results.classList.add("hidden");
  const families = el("fontFamiliesList");
  const summary = el("fontConsistencySummary");
  if (families) families.innerHTML = '';
  if (summary) { summary.classList.add("hidden"); summary.innerHTML = ''; }
  if (scanBtn) scanBtn.style.display = '';
  showToast("Font results cleared", 'info');
});

// ─── Font Start Scan Button ───────────────────────────────────────────────────

el("fontsScanButton")?.addEventListener("click", async () => {
  if (!state.trackedTabId || !state.trackedUrl) {
    showToast("No tab pinned", 'warning');
    return;
  }
  const scanBtn = el("fontsScanButton");
  if (scanBtn) scanBtn.style.display = 'none';
  el("scanFontsBtn")?.click();
});

// ==================== CHOOSE JOURNEY ====================

const JOURNEY_COOKIES = {
  HD: ['HdVisitorGroup', 'HdVistorGroup'],
  TD: ['VisitorGroup', 'VistorGroup']
};

// All cookie names across both conditions — so switching from HD to TD clears HD too
const ALL_JOURNEY_COOKIE_NAMES = [
  'HdVisitorGroup', 'HdVistorGroup', 'VisitorGroup', 'VistorGroup'
];

document.querySelectorAll('.journey-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!state.trackedTabId || !state.trackedUrl) {
      showToast('Pin a tab first', 'warning');
      return;
    }

    const condition = btn.dataset.condition;
    const value = btn.dataset.value;
    const url = state.trackedUrl;

    let domain;
    try {
      domain = new URL(url).hostname;
    } catch {
      showToast('Invalid tracked URL', 'error');
      return;
    }

    const status = el('journeyInjectStatus');
    if (status) status.textContent = 'Setting journey cookie...';

    await Promise.allSettled(
      ALL_JOURNEY_COOKIE_NAMES.map(name => {
        const scheme = url.startsWith('https') ? 'https://' : 'http://';
        return chrome.cookies.remove({ url: `${scheme}${domain}/`, name });
      })
    );

    const names = JOURNEY_COOKIES[condition];
    const setResults = await Promise.allSettled(
      names.map(name =>
        chrome.cookies.set({ url, name, value, domain, path: '/', sameSite: 'lax' })
      )
    );

    const succeeded = setResults.filter(r => r.status === 'fulfilled' && r.value).length;

    if (succeeded > 0) {
      document.querySelectorAll('.journey-btn').forEach(b => b.classList.remove('journey-btn--active'));
      btn.classList.add('journey-btn--active');
      if (status) status.textContent = `${condition} — ${btn.textContent.trim()} — reloading page...`;
      showToast(`Journey set: ${btn.textContent.trim()}`, 'success');
      await chrome.tabs.reload(state.trackedTabId, { bypassCache: true });
      setTimeout(() => {
        fetchReport();
        if (status) status.textContent = `Active: ${condition} — ${btn.textContent.trim()}`;
      }, 1800);
    } else {
      if (status) status.textContent = '';
      showToast('Could not set cookie — is the tab pinned to this domain?', 'error');
    }
  });
});

// Dropdown journey injection
async function applyJourneyDropdown(condition, value) {
  if (!state.trackedTabId || !state.trackedUrl) {
    showToast('Pin a tab first', 'warning');
    const sel = el(`journeySelect${condition}`);
    if (sel) sel.value = 'unknown';
    return;
  }

  const url = state.trackedUrl;
  let domain;
  try { domain = new URL(url).hostname; } catch {
    showToast('Invalid tracked URL', 'error');
    return;
  }

  const status = el('journeyInjectStatus');
  if (status) status.textContent = 'Setting journey cookie...';

  window.__dropdownInjecting = true;

  // Clear all journey cookies
  await Promise.allSettled(
    ALL_JOURNEY_COOKIE_NAMES.map(name => {
      const scheme = url.startsWith('https') ? 'https://' : 'http://';
      return chrome.cookies.remove({ url: `${scheme}${domain}/`, name });
    })
  );

  if (value === 'unknown') {
    if (status) status.textContent = '';
    showToast('Journey cleared', 'info');
    await chrome.tabs.reload(state.trackedTabId, { bypassCache: true });
    setTimeout(() => { window.__dropdownInjecting = false; fetchReport(); }, 1800);
    return;
  }

  const names = JOURNEY_COOKIES[condition];
  const setResults = await Promise.allSettled(
    names.map(name => chrome.cookies.set({ url, name, value, domain, path: '/', sameSite: 'lax' }))
  );

  const succeeded = setResults.filter(r => r.status === 'fulfilled' && r.value).length;

  if (succeeded > 0) {
    const sel = el(`journeySelect${condition}`);
    const label = sel?.options[sel.selectedIndex]?.text || value;
    if (status) status.textContent = `${condition} — ${label} — reloading...`;
    showToast(`Journey set: ${label}`, 'success');
    await chrome.tabs.reload(state.trackedTabId, { bypassCache: true });
    setTimeout(() => {
      window.__dropdownInjecting = false;
      fetchReport();
      if (status) status.textContent = `Active: ${condition} — ${label}`;
    }, 1800);
  } else {
    window.__dropdownInjecting = false;
    if (status) status.textContent = '';
    showToast('Could not set cookie — is the tab pinned?', 'error');
  }
}

// Wire dropdowns
['HD', 'TD'].forEach(condition => {
  const sel = el(`journeySelect${condition}`);
  if (!sel) return;
  sel.addEventListener('change', () => applyJourneyDropdown(condition, sel.value));
});

// Sync dropdowns to live cookie state
function syncJourneyDropdowns(cookies) {
  if (window.__dropdownInjecting) return;
  const hdCookie = (cookies || []).find(c => /^(HdVisitorGroup|HdVistorGroup)$/i.test(c.name));
  const tdCookie = (cookies || []).find(c => /^(VisitorGroup|VistorGroup)$/i.test(c.name));
  const hdSel = el('journeySelectHD');
  const tdSel = el('journeySelectTD');
  if (hdSel) hdSel.value = hdCookie?.value || 'unknown';
  if (tdSel) tdSel.value = tdCookie?.value || 'unknown';
}

/* ═══════════════════════════════════════════════════════════════════════
   Diagnostics
   ═══════════════════════════════════════════════════════════════════════ */

(function initDiagnostics() {
  const panel = el('diagPanel');
  const toggle = el('diagToggle');
  const closeBtn = el('diagClose');
  const checksEl = el('diagChecks');
  const timestampEl = el('diagTimestamp');
  const copyBtn = el('diagCopy');
  if (!panel || !toggle) return;

  let reportText = '';

  // ── Toggle ──
  function openDiag() {
    panel.classList.remove('hidden');
    toggle.setAttribute('aria-expanded', 'true');
    runDiagnostics();
  }
  function closeDiag() {
    panel.classList.add('hidden');
    toggle.setAttribute('aria-expanded', 'false');
  }
  toggle.addEventListener('click', () => {
    if (panel.classList.contains('hidden')) openDiag();
    else closeDiag();
  });
  if (closeBtn) closeBtn.addEventListener('click', closeDiag);

  // ── Render helpers ──
  function addRow(id, status, label, detail) {
    const existing = document.getElementById('diag-' + id);
    if (existing) existing.remove();
    const row = document.createElement('div');
    row.className = 'diag-row ' + status;
    row.id = 'diag-' + id;
    const icons = { pass: '✓', fail: '✗', warn: '!', running: '' };
    row.innerHTML =
      '<span class="diag-status">' + (icons[status] || '') + '</span>' +
      '<div class="diag-content">' +
        '<div class="diag-label">' + label + '</div>' +
        (detail ? '<div class="diag-detail">' + detail + '</div>' : '') +
      '</div>';
    checksEl.appendChild(row);
  }

  function addSeparator(id) {
    const sep = document.createElement('div');
    sep.className = 'diag-separator';
    sep.id = 'diag-sep-' + id;
    checksEl.appendChild(sep);
  }

  // ── Messaging with timeout ──
  function sendMsg(msg, timeoutMs) {
    return new Promise(function(resolve) {
      const timer = setTimeout(function() { resolve(null); }, timeoutMs || 3000);
      try {
        chrome.runtime.sendMessage(msg, function(resp) {
          clearTimeout(timer);
          resolve(resp || null);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  function pingTab(tabId, timeoutMs) {
    return new Promise(function(resolve) {
      const timer = setTimeout(function() { resolve(null); }, timeoutMs || 2000);
      try {
        chrome.tabs.sendMessage(tabId, { type: 'PING' }, function(resp) {
          clearTimeout(timer);
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(resp || null);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  // ── Supported site check ──
  function isSupportedSite(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.includes('austedo') || u.includes('austedoxr');
  }

  // ── Run all checks ──
  async function runDiagnostics() {
    checksEl.innerHTML = '';
    reportText = '';
    const now = new Date();
    const ts = now.toLocaleDateString() + ', ' + now.toLocaleTimeString();
    if (timestampEl) timestampEl.textContent = ts;

    const lines = ['Cookie Tracer+ Diagnostics — ' + ts, ''];

    // 1. Background script
    addRow('bg', 'running', 'Background script', 'Checking...');
    const bgResp = await sendMsg({ type: 'DIAG_PING' }, 3000);
    if (bgResp && bgResp.ok) {
      addRow('bg', 'pass', 'Background script responding', 'v' + (bgResp.version || '?'));
      lines.push('✔ Background script responding (v' + (bgResp.version || '?') + ')');
    } else {
      addRow('bg', 'fail', 'Background script not responding', 'Extension may need reload');
      lines.push('✖ Background script not responding');
    }

    // 2. Pinned tab
    addRow('pin', 'running', 'Pinned tab', 'Checking...');
    const tracked = await sendMsg({ type: 'GET_TRACKED' }, 3000);
    const tabId = tracked?.trackedTabId;
    const trackedUrl = tracked?.trackedUrl || '';

    if (!tabId) {
      addRow('pin', 'warn', 'No tab pinned', 'Pin a tab to start tracking');
      lines.push('⚠ No tab pinned');
    } else {
      // 3. Tab still exists?
      let tabAlive = false;
      try {
        const tab = await chrome.tabs.get(tabId);
        tabAlive = !!tab;
      } catch (e) { tabAlive = false; }

      if (!tabAlive) {
        addRow('pin', 'fail', 'Pinned tab no longer exists', 'Tab ID ' + tabId + ' was closed');
        lines.push('✖ Pinned tab no longer exists (ID ' + tabId + ')');
      } else {
        addRow('pin', 'pass', 'Tab pinned', trackedUrl);
        lines.push('✔ Tab pinned: ' + trackedUrl);

        addSeparator('site');

        // 4. Supported site
        if (isSupportedSite(trackedUrl)) {
          addRow('site', 'pass', 'Supported site detected', '');
          lines.push('✔ Supported site detected');
        } else {
          addRow('site', 'warn', 'Not a recognized AUSTEDO site', 'Expected AustedoXR.com or UAT');
          lines.push('⚠ Not a recognized AUSTEDO site');
        }

        // 5. Content script
        addRow('cs', 'running', 'Content script', 'Checking...');
        const csResp = await pingTab(tabId, 2000);
        if (csResp && csResp.ok) {
          addRow('cs', 'pass', 'Content script injected', '');
          lines.push('✔ Content script injected');
        } else {
          addRow('cs', 'fail', 'Content script not detected', 'Try refreshing the pinned tab');
          lines.push('✖ Content script not detected');
        }

        addSeparator('cookies');

        // 6. Cookie access
        addRow('cook', 'running', 'Cookie access', 'Checking...');
        try {
          const cookies = await chrome.cookies.getAll({ url: trackedUrl });
          addRow('cook', 'pass', 'Cookie access confirmed', cookies.length + ' cookies readable');
          lines.push('✔ Cookie access confirmed (' + cookies.length + ' cookies)');

          // 7. Journey cookies
          const hdCook = cookies.find(function(c) {
            return /^(HdVisitorGroup|HdVistorGroup)$/i.test(c.name);
          });
          const tdCook = cookies.find(function(c) {
            return /^(VisitorGroup|VistorGroup)$/i.test(c.name);
          });
          const hdVal = hdCook ? hdCook.value : 'not set';
          const tdVal = tdCook ? tdCook.value : 'not set';
          addRow('hd', hdCook ? 'pass' : 'warn', 'HD cookie: ' + hdVal, hdCook ? hdCook.name : '');
          addRow('td', tdCook ? 'pass' : 'warn', 'TD cookie: ' + tdVal, tdCook ? tdCook.name : '');
          lines.push('HD cookie: ' + hdVal);
          lines.push('TD cookie: ' + tdVal);
        } catch (e) {
          addRow('cook', 'fail', 'Cookie access denied', e.message || 'Permission error');
          lines.push('✖ Cookie access denied');
        }
      }
    }

    // Build report
    const passCount = checksEl.querySelectorAll('.diag-row.pass').length;
    const failCount = checksEl.querySelectorAll('.diag-row.fail').length;
    const warnCount = checksEl.querySelectorAll('.diag-row.warn').length;
    lines.push('');
    lines.push('Summary: ' + passCount + ' passed, ' + warnCount + ' warnings, ' + failCount + ' failed');
    reportText = lines.join('\n');
  }

  // ── Copy Report ──
  if (copyBtn) {
    copyBtn.addEventListener('click', async function() {
      if (!reportText) return;
      try {
        await navigator.clipboard.writeText(reportText);
        copyBtn.classList.add('copied');
        copyBtn.textContent = 'Copied!';
        setTimeout(function() {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML =
            '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-copy"/></svg> Copy Report';
        }, 2000);
      } catch (e) {
        showToast('Could not copy to clipboard', 'error');
      }
    });
  }
})();
