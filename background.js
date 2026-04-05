// Cookie Tracer+ Background Service Worker
// Version 1.9.2 - Enhanced error handling and stability

// Cookie Tracer+ Background Service Worker
// Version 1.9.2 - Enhanced error handling and stability

// Global error handler for service worker - suppress to keep console clean
self.addEventListener('error', (event) => {
  // Silently handle
});

self.addEventListener('unhandledrejection', (event) => {
  // Silently handle
});

let inspectorWindowId = null;
let inspectorWindowTabId = null;

// ── Staging vs Prod comparison session ───────────────────────────────
let scSession = null;
// { winIds: [id1,id2], tabIds: [tid1,tid2], urls: [url1,url2], syncScroll: bool, syncNav: bool }

// Clear stale tracking on install/update — guarantees clean state
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove(['trackedTabId', 'trackedUrl', 'trackedTitle', 'trackedWindowId']).catch(() => {});
});

const TAB_STATE = new Map();
const SERVER_ERRORS = []; // HTTP error log (4xx + 5xx)
const MAX_SERVER_ERRORS = 50;
const CONSOLE_ERRORS = []; // JS console error log
const MAX_CONSOLE_ERRORS = 100;

const CHANGE_LOG_MAX = 50;
const CHANGELOG_KEY = "ct_change_log";
const FINGERPRINT_KEY_PREFIX = "ct_fp:";

// Error logging helper
function logError(context, error) {
  // Silently handle - errors shown via toast to user
}

async function getStored(key){
  try {
    return await chrome.storage.local.get(key);
  } catch (error) {
    logError('getStored', error);
    return {};
  }
}
async function setStored(obj){
  try {
    return await chrome.storage.local.set(obj);
  } catch (error) {
    logError('setStored', error);
  }
}

function classifyUrlForLog(pageHost, u){
  try{
    const url = new URL(u);
    const h = url.hostname;
    const internal = (h === pageHost) || h.endsWith("." + pageHost);
    const isBundle = /DependencyHandler\.axd/i.test(u);
    return isBundle ? "bundle" : (internal ? "internal" : "thirdparty");
  }catch{ return "bundle"; }
}

async function headMeta(u){
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const res = await fetch(u, { 
      method: "HEAD", 
      cache: "no-store", 
      credentials: "omit",
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const lm = res.headers.get("last-modified");
    const etag = res.headers.get("etag");
    return { ok: true, lastModified: lm || null, etag: etag || null };
  } catch(e) { 
    logError('headMeta', e);
    return { ok:false, lastModified:null, etag:null }; 
  }
}

function pushLog(log, entry){
  log.unshift(entry);
  if (log.length > CHANGE_LOG_MAX) log.length = CHANGE_LOG_MAX;
  return log;
}


async function syncTrackedUrl(tabId, url) {
  try {
    const data = await chrome.storage.session.get(["trackedTabId"]);
    if (data?.trackedTabId === tabId && url) {
      await chrome.storage.session.set({ trackedUrl: url });
    }
  } catch (error) {
    logError('syncTrackedUrl', error);
  }
}


function getHost(url) { try { return new URL(url).hostname; } catch { return null; } }
function cookieKey(c) { return `${c.name}|${c.domain}|${c.path}`; }
function ensureState(tabId, url) {
  let st = TAB_STATE.get(tabId);
  if (!st) { 
    st = { 
      url, 
      host: getHost(url), 
      baseline: [], 
      final: [], 
      baselineAt: null, 
      finalAt: null, 
      setCookieEvents: [], 
      resources: [],
      tabCookies: new Set() // Track cookies specific to this tab
    }; 
    TAB_STATE.set(tabId, st); 
  }
  return st;
}
async function snapshot(tabId, url, phase) {
  try {
    const host = getHost(url); 
    if (!host) return;
    
    const st = ensureState(tabId, url); 
    st.url = url; 
    st.host = host;
    
    const cookies = await chrome.cookies.getAll({ domain: host });
    
    if (phase === "baseline") { 
      st.baseline = cookies;
      st.baselineAt = new Date().toISOString(); 
      st.final = [];
      // Record baseline cookies
      cookies.forEach(c => st.tabCookies.add(cookieKey(c)));
    } else if (phase === "final") { 
      st.final = cookies;
      st.finalAt = new Date().toISOString();
      // Track any new cookies that appeared
      cookies.forEach(c => st.tabCookies.add(cookieKey(c)));
    }
  } catch (error) {
    logError(`snapshot-${phase}`, error);
  }
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  try {
    if (!tab?.url) return;
    if (info.status === "loading") snapshot(tabId, tab.url, "baseline").catch(err => logError('snapshot-loading', err));
    if (info.status === "complete") {
      snapshot(tabId, tab.url, "final").catch(err => logError('snapshot-complete', err));
      // Notify inspector if this is the tracked tab
      chrome.storage.session.get(['trackedTabId']).then(data => {
        if (data?.trackedTabId === tabId) {
          chrome.runtime.sendMessage({ type: 'NAVIGATION', url: tab.url }).catch(() => {});
        }
      }).catch(() => {});
    }
  } catch (error) {
    logError('tabs.onUpdated', error);
  }
});
chrome.tabs.onRemoved.addListener(tabId => TAB_STATE.delete(tabId));

// Track cookie changes per tab using webRequest to correlate with tab
// This is the ONLY way to know which tab set which cookie
const TAB_COOKIE_REQUESTS = new Map(); // Maps requestId -> tabId

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId > 0) {
      TAB_COOKIE_REQUESTS.set(details.requestId, {
        tabId: details.tabId,
        url: details.url,
        timestamp: Date.now()
      });
      
      // Clean up old entries (older than 10 seconds)
      const cutoff = Date.now() - 10000;
      for (const [reqId, data] of TAB_COOKIE_REQUESTS.entries()) {
        if (data.timestamp < cutoff) {
          TAB_COOKIE_REQUESTS.delete(reqId);
        }
      }
    }
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders"]
);

// Monitor cookie changes and attribute them to tabs
chrome.cookies.onChanged.addListener((changeInfo) => {
  try {
    if (!changeInfo.cookie || changeInfo.removed) return;
    
    const cookie = changeInfo.cookie;
    const cookieDomain = cookie.domain;
    
    // Try to find which tab made this request
    // This is best-effort since we can't directly correlate cookies to tabs
    for (const [tabId, state] of TAB_STATE.entries()) {
      if (!state.host) continue;
      
      // Check if this cookie's domain matches the tab's host
      if (cookieDomain.includes(state.host) || state.host.includes(cookieDomain.replace(/^\./, ''))) {
        if (!state.tabCookies) state.tabCookies = new Set();
        state.tabCookies.add(cookieKey(cookie));
        console.log(`[Cookie Tracer+] Tab ${tabId} set cookie: ${cookie.name}`);
      }
    }
  } catch (error) {
    logError('cookies.onChanged', error);
  }
});


// --- HTTP Error Monitor (4xx + 5xx) ---
chrome.webRequest.onCompleted.addListener(
  async (details) => {
    if (details.statusCode >= 400 && details.tabId > 0 && details.type === 'main_frame') {
      console.log(`[Error Monitor] ${details.statusCode} on ${details.url}`);
      
      const is5xx = details.statusCode >= 500;
      const errorEntry = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
        url: details.url,
        statusCode: details.statusCode,
        statusLine: details.statusLine || `HTTP ${details.statusCode}`,
        timestamp: new Date().toISOString(),
        tabId: details.tabId,
        category: is5xx ? 'server' : 'client',
        responseHeaders: {},
        body: null,
        parsed: null
      };
      
      // Capture relevant response headers
      if (details.responseHeaders) {
        for (const h of details.responseHeaders) {
          const name = h.name.toLowerCase();
          if (['content-type', 'server', 'x-powered-by', 'x-aspnet-version'].includes(name)) {
            errorEntry.responseHeaders[h.name] = h.value;
          }
        }
      }
      
      // Only fetch body for 5xx (likely to have stack traces)
      if (is5xx) {
        try {
          const controller = new AbortController();
          setTimeout(() => controller.abort(), 8000);
          const resp = await fetch(details.url, {
            method: 'GET',
            cache: 'no-store',
            credentials: 'include',
            signal: controller.signal
          });
          const html = await resp.text();
          errorEntry.body = html.substring(0, 50000);
          errorEntry.parsed = parseAspNetError(html);
        } catch (e) {
          console.log('[Error Monitor] Could not fetch body:', e.message);
        }
      }
      
      SERVER_ERRORS.unshift(errorEntry);
      if (SERVER_ERRORS.length > MAX_SERVER_ERRORS) SERVER_ERRORS.length = MAX_SERVER_ERRORS;
      
      // Notify inspector
      chrome.runtime.sendMessage({ type: 'SERVER_ERROR', error: errorEntry }).catch(() => {});
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Parse ASP.NET Yellow Screen of Death
function parseAspNetError(html) {
  if (!html) return null;
  const result = {};
  
  // Exception type + message (bold red/maroon text after "Server Error")
  const titleMatch = html.match(/<b>\s*(.*?)\s*<\/b>/);
  const descMatch = html.match(/<b>Description:\s*<\/b>\s*(.*?)(?:<br|<\/p)/i);
  const exceptionMatch = html.match(/<b>Exception Details:\s*<\/b>\s*(.*?)(?:<br|<\/p)/i);
  const sourceMatch = html.match(/<b>Source Error:\s*<\/b>[\s\S]*?<code>([\s\S]*?)<\/code>/i);
  
  // Stack trace â€” inside <pre> after "Stack Trace:"
  const stackMatch = html.match(/Stack Trace:[\s\S]*?<pre>([\s\S]*?)<\/pre>/i);
  
  // Fallback: grab first <h2> style title
  const h2Match = html.match(/<span><H2>\s*<i>\s*([\s\S]*?)<\/i>/i) || html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  
  if (h2Match) {
    result.errorTitle = h2Match[1].replace(/<[^>]+>/g, '').trim();
  }
  if (titleMatch) {
    result.title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
  }
  if (descMatch) {
    result.description = descMatch[1].replace(/<[^>]+>/g, '').trim();
  }
  if (exceptionMatch) {
    result.exception = exceptionMatch[1].replace(/<[^>]+>/g, '').trim();
  }
  if (sourceMatch) {
    result.sourceError = sourceMatch[1].replace(/<[^>]+>/g, '').trim();
  }
  if (stackMatch) {
    const rawStack = stackMatch[1].replace(/<[^>]+>/g, '').trim();
    // Filter meaningful frames (skip System.Web.Mvc.Async noise)
    const lines = rawStack.split('\n').map(l => l.trim()).filter(Boolean);
    const meaningful = [];
    const noise = [];
    for (const line of lines) {
      if (line.match(/^System\.Web\.Mvc\.Async\./)) {
        noise.push(line);
      } else {
        meaningful.push(line);
      }
    }
    result.stackTrace = meaningful;
    result.noiseFrames = noise.length;
    result.fullStack = rawStack;
  }
  
  return (result.exception || result.title || result.stackTrace) ? result : null;
}

async function openOrFocusInspector() {
  try {
    if (inspectorWindowId != null) {
      try { 
        await chrome.windows.get(inspectorWindowId); 
        await chrome.windows.update(inspectorWindowId, { focused: true }); 
        return; 
      } catch { 
        inspectorWindowId = null; 
        inspectorWindowTabId = null; 
      }
    }
    const w = await chrome.windows.create({ 
      url: chrome.runtime.getURL("inspector.html"), 
      type: "popup", 
      width: 640, 
      height: 820, 
      focused: true 
    });
    inspectorWindowId = w.id; 
    inspectorWindowTabId = w.tabs?.[0]?.id ?? null;
  } catch (error) {
    logError('openOrFocusInspector', error);
  }
}
chrome.action.onClicked.addListener(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id && tab.windowId != null && tab.url) {
      await chrome.storage.session.set({ 
        trackedTabId: tab.id, 
        trackedWindowId: tab.windowId, 
        trackedUrl: tab.url, 
        trackedTitle: tab.title || "" 
      });
    }
    await openOrFocusInspector();
  } catch (error) {
    logError('action.onClicked', error);
  }
});
chrome.windows.onRemoved.addListener((winId) => {
  if (winId === inspectorWindowId) { inspectorWindowId = null; inspectorWindowTabId = null; }
  if (scSession && scSession.winIds.includes(winId)) {
    const otherId = scSession.winIds.find(id => id !== winId);
    if (otherId) { try { chrome.windows.remove(otherId).catch(() => {}); } catch {} }
    scSession = null;
    chrome.runtime.sendMessage({ type: 'SC_SESSION_ENDED' }).catch(() => {});
  }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "GET_TRACKED") {
        const data = await chrome.storage.session.get(["trackedTabId","trackedWindowId","trackedUrl","trackedTitle"]); 
        sendResponse({ ok: true, ...data }); 
        return;
      }

      // ── Staging vs Prod comparison ──────────────────────────────────
      if (msg?.type === "OPEN_COMPARISON") {
        // Close any existing session first
        if (scSession) {
          for (const wid of scSession.winIds) {
            try { await chrome.windows.remove(wid).catch(() => {}); } catch {}
          }
          scSession = null;
        }
        const { url1, url2, mode, syncScroll, syncNav, screenW, screenH } = msg;
        let left1, left2, top1, top2, w1, h1, w2, h2;
        if (mode === 'mobile') {
          w1 = w2 = 430; h1 = h2 = 844;
          const totalW = w1 + w2 + 24;
          left1 = Math.max(0, Math.floor((screenW - totalW) / 2));
          left2 = left1 + w1 + 24;
          top1 = top2 = Math.max(0, Math.floor((screenH - h1) / 4));
        } else {
          w1 = w2 = Math.floor(screenW / 2);
          h1 = h2 = screenH;
          left1 = 0; left2 = w1; top1 = top2 = 0;
        }
        try {
          const [win1, win2] = await Promise.all([
            chrome.windows.create({ url: url1, type: 'normal', left: left1, top: top1, width: w1, height: h1 }),
            chrome.windows.create({ url: url2, type: 'normal', left: left2, top: top2, width: w2, height: h2 })
          ]);
          const tabId1 = win1.tabs?.[0]?.id;
          const tabId2 = win2.tabs?.[0]?.id;
          scSession = { winIds: [win1.id, win2.id], tabIds: [tabId1, tabId2], urls: [url1, url2], syncScroll, syncNav };
          async function injectSync(tabId) {
            await new Promise(resolve => {
              let done = false;
              const listener = (tid, changeInfo) => {
                if (tid === tabId && changeInfo.status === 'complete' && !done) {
                  done = true;
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }
              };
              chrome.tabs.onUpdated.addListener(listener);
              setTimeout(() => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(listener); resolve(); } }, 10000);
            });
            try { await chrome.scripting.executeScript({ target: { tabId }, files: ['comparison-content.js'] }); } catch {}
          }
          if (tabId1) injectSync(tabId1).catch(() => {});
          if (tabId2) injectSync(tabId2).catch(() => {});
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return;
      }
      if (msg?.type === "CLOSE_COMPARISON") {
        if (scSession) {
          for (const wid of scSession.winIds) {
            try { await chrome.windows.remove(wid).catch(() => {}); } catch {}
          }
          scSession = null;
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "SC_SCROLL") {
        if (scSession?.syncScroll) {
          const senderTabId = sender?.tab?.id;
          const otherTabId = scSession.tabIds.find(id => id !== senderTabId);
          if (otherTabId) {
            try { await chrome.tabs.sendMessage(otherTabId, { type: 'SC_DO_SCROLL', scrollX: msg.scrollX, scrollY: msg.scrollY }).catch(() => {}); } catch {}
          }
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "SC_NAVIGATE") {
        if (scSession?.syncNav) {
          const senderTabId = sender?.tab?.id;
          const senderIdx = scSession.tabIds.indexOf(senderTabId);
          const otherIdx = senderIdx === 0 ? 1 : 0;
          const otherTabId = scSession.tabIds[otherIdx];
          const otherBaseUrl = scSession.urls[otherIdx];
          if (otherTabId && otherBaseUrl) {
            try {
              const base = new URL(otherBaseUrl);
              const targetUrl = base.origin + msg.path;
              scSession.urls[otherIdx] = targetUrl;
              await chrome.tabs.sendMessage(otherTabId, { type: 'SC_DO_NAVIGATE', url: targetUrl }).catch(() => {});
            } catch {}
          }
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "SC_UPDATE_OPTS") {
        if (scSession) { scSession.syncScroll = msg.syncScroll; scSession.syncNav = msg.syncNav; }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "GET_SC_SESSION") {
        sendResponse({ ok: true, active: !!scSession });
        return;
      }
      // ── End comparison ──────────────────────────────────────────────
      if (msg?.type === "OPEN_EMULATOR_IN_TAB") {
        const data = await chrome.storage.session.get(["trackedTabId","trackedWindowId","trackedUrl"]);
        const tabId = data?.trackedTabId;
        if (!tabId) { sendResponse({ ok: false, error: "No pinned tab" }); return; }
        // Focus the pinned tab so user sees it take over
        if (data.trackedWindowId) {
          try { await chrome.windows.update(data.trackedWindowId, { focused: true }); } catch {}
        }
        await chrome.tabs.update(tabId, { active: true });
        // Inject overlay script programmatically — ensures it runs even in
        // already-open tabs that loaded before the extension was installed/reloaded.
        // The guard in emulator-overlay.js prevents double-registration.
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["emulator-overlay.js"]
          });
        } catch (injectErr) {
          logError("OPEN_EMULATOR_IN_TAB inject", injectErr);
        }
        // Now the listener is guaranteed to be registered — send show command
        await chrome.tabs.sendMessage(tabId, {
          type: "SHOW_EMULATOR",
          devices: msg.devices,
          url: data.trackedUrl || ""
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "CLOSE_EMULATOR_IN_TAB") {
        const data = await chrome.storage.session.get(["trackedTabId"]);
        const tabId = data?.trackedTabId;
        if (tabId) {
          try { await chrome.tabs.sendMessage(tabId, { type: "HIDE_EMULATOR" }); } catch {}
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "DIAG_PING") {
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
        return;
      }
      if (msg?.type === "GET_TAB_REPORT") {
        const { tabId, url } = msg; 
        const st = TAB_STATE.get(tabId) || ensureState(tabId, url);
        const host = getHost(url) || st.host;
        const cookies = (st.final?.length ? st.final : st.baseline) || [];
        sendResponse({ ok: true, host, pageUrl: url, cookies, resources: st.resources || [] }); 
        return;
      }
      if (msg?.type === "FOCUS_WINDOW") { 
        try { 
          await chrome.windows.update(msg.windowId, { focused: true }); 
        } catch (error) {
          logError('FOCUS_WINDOW', error);
        }
        sendResponse({ ok: true }); 
        return; 
      }
      if (msg?.type === "ROUTE_CHANGE") {
        // Only process route changes from the tracked tab
        const data = await chrome.storage.session.get(["trackedTabId"]);
        if (sender?.tab?.id && sender.tab.id === data?.trackedTabId && msg.url) { 
          await syncTrackedUrl(sender.tab.id, msg.url); 
          chrome.runtime.sendMessage({ type: "NAVIGATION", url: msg.url }).catch(() => {});
        }
        sendResponse({ ok: true });
        return;
      }
      
      // New: Fetch sitemap (background script has no CORS restrictions)
      if (msg?.type === "FETCH_SITEMAP") {
        console.log('[Background] Fetching sitemap:', msg.url);
        try {
          const response = await fetch(msg.url, {
            method: 'GET',
            cache: 'no-cache',
            headers: {
              'Accept': 'text/html,application/xml,text/xml,*/*'
            }
          });
          
          console.log('[Background] Fetch response status:', response.status);
          
          if (!response.ok) {
            // console.warn('[Background] Sitemap not found:', msg.url, 'Status:', response.status);
            sendResponse({ ok: false, error: `HTTP ${response.status}` });
            return;
          }
          
          const xml = await response.text();
          console.log('[Background] Fetched sitemap, length:', xml.length);
          sendResponse({ ok: true, xml: xml });
        } catch (error) {
          // console.error('[Background] FETCH_SITEMAP error:', error);
          sendResponse({ ok: false, error: error.message });
        }
        return;
      }
      
      // Fetch HTML for scanning (no tab needed!)
      if (msg?.type === "FETCH_HTML") {
        try {
          const response = await fetch(msg.url, {
            method: 'GET',
            cache: 'no-cache',
            headers: {
              'Accept': 'text/html'
            }
          });
          
          if (!response.ok) {
            sendResponse({ ok: false, statusText: `HTTP ${response.status}` });
            return;
          }
          
          const html = await response.text();
          sendResponse({ ok: true, html: html });
        } catch (error) {
          // console.error('[Background] FETCH_HTML error:', error);
          sendResponse({ ok: false, error: error.message });
        }
        return;
      }
      
      // New: Force track a specific tab
      if (msg?.type === "TRACK_THIS_TAB") {
        const { tabId, url, title } = msg;
        console.log('[Background] Forcing track of tab:', tabId, url);
        
        try {
          // Store in session
          await chrome.storage.session.set({
            trackedTabId: tabId,
            trackedUrl: url,
            trackedTitle: title || '',
            trackedWindowId: (await chrome.tabs.get(tabId)).windowId
          });
          
          // CRITICAL: Initialize TAB_STATE for this tab so GET_TAB_REPORT has data
          ensureState(tabId, url);
          
          // Trigger baseline cookie capture
          const domain = getHost(url);
          if (domain) {
            const cookies = await chrome.cookies.getAll({ domain });
            const st = TAB_STATE.get(tabId);
            if (st) {
              st.baseline = cookies;
              st.baselineAt = Date.now();
              console.log('[Background] Captured', cookies.length, 'baseline cookies for newly pinned tab');
            }
          }
          
          sendResponse({ ok: true });
        } catch (error) {
          // console.error('[Background] TRACK_THIS_TAB error:', error);
          sendResponse({ ok: false, error: error.message });
        }
        return;
      }
      
      // New: Clear cookies specific to a tab
      if (msg?.type === "CLEAR_TAB_COOKIES") {
        const { tabId, url } = msg;
        if (!tabId || !url) {
          sendResponse({ ok: false, error: "Missing tabId or url" });
          return;
        }
        
        const st = TAB_STATE.get(tabId);
        if (!st || !st.tabCookies) {
          sendResponse({ ok: true, cleared: 0 }); // No tracked cookies for this tab
          return;
        }
        
        const host = getHost(url);
        if (!host) {
          sendResponse({ ok: false, error: "Invalid URL" });
          return;
        }
        
        // Get ALL current cookies for the domain
        const allCookies = await chrome.cookies.getAll({ domain: host });
        
        // Only delete cookies that were tracked for THIS tab
        let cleared = 0;
        for (const cookie of allCookies) {
          const key = cookieKey(cookie);
          if (st.tabCookies.has(key)) {
            const scheme = cookie.secure ? "https://" : "http://";
            const removeUrl = scheme + cookie.domain.replace(/^\./, "") + cookie.path;
            try {
              await chrome.cookies.remove({ url: removeUrl, name: cookie.name });
              st.tabCookies.delete(key); // Remove from tracking
              cleared++;
            } catch (error) {
              logError('cookie.remove', error);
            }
          }
        }
        
        sendResponse({ ok: true, cleared });
        return;
      }
      
      if (msg?.type === "GET_CHANGE_LOG") {
        const data = await chrome.storage.local.get([CHANGELOG_KEY]);
        const items = data[CHANGELOG_KEY] || [];
        sendResponse({ ok: true, items });
        return;
      }

      if (msg?.type === "GET_SERVER_ERRORS") {
        sendResponse({ ok: true, errors: SERVER_ERRORS });
        return;
      }
      
      if (msg?.type === "CLEAR_SERVER_ERRORS") {
        SERVER_ERRORS.length = 0;
        sendResponse({ ok: true });
        return;
      }

      // Console Logger
      if (msg?.type === "CONSOLE_ERROR") {
        const entry = {
          id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
          level: msg.level || 'error',
          message: msg.message || '',
          source: msg.source || '',
          lineno: msg.lineno || null,
          colno: msg.colno || null,
          stack: msg.stack || null,
          url: msg.url || sender?.tab?.url || '',
          timestamp: new Date().toISOString(),
          tabId: sender?.tab?.id || null
        };
        CONSOLE_ERRORS.unshift(entry);
        if (CONSOLE_ERRORS.length > MAX_CONSOLE_ERRORS) CONSOLE_ERRORS.length = MAX_CONSOLE_ERRORS;
        // Forward to inspector
        chrome.runtime.sendMessage({ type: 'CONSOLE_LOG_ENTRY', entry }).catch(() => {});
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "GET_CONSOLE_ERRORS") {
        sendResponse({ ok: true, errors: CONSOLE_ERRORS });
        return;
      }
      
      if (msg?.type === "CLEAR_CONSOLE_ERRORS") {
        CONSOLE_ERRORS.length = 0;
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === "UPDATE_FINGERPRINT") {
        const fp = msg.fingerprint || {};
        const url = fp.url;
        if (!url) { sendResponse({ ok: false }); return; }
        const host = getHost(url);
        const pageHost = host || "";
        const key = FINGERPRINT_KEY_PREFIX + url;

        const stored = await chrome.storage.local.get([key, CHANGELOG_KEY]);
        const prev = stored[key] || null;
        let log = stored[CHANGELOG_KEY] || [];

        // Compare lists (scripts/styles) and meta headers
        const next = {
          url,
          scripts: Array.isArray(fp.scripts) ? fp.scripts.slice(0, 50) : [],
          styles: Array.isArray(fp.styles) ? fp.styles.slice(0, 50) : []
        };

        // helper to detect list diffs
        const diffList = (a,b) => {
          const sa=new Set(a||[]), sb=new Set(b||[]);
          const added=[...(b||[])].filter(x=>!sa.has(x));
          const removed=[...(a||[])].filter(x=>!sb.has(x));
          return {added, removed};
        };

        // record adds/removes
        if (prev) {
          const dS = diffList(prev.scripts, next.scripts);
          const dC = diffList(prev.styles, next.styles);
          const now = new Date().toISOString();
          dS.added.forEach(u=>{ log = pushLog(log,{ type:"JS added", url:u, seenAt:now, serverLastModified:null, classification:classifyUrlForLog(pageHost,u) }); });
          dS.removed.forEach(u=>{ log = pushLog(log,{ type:"JS removed", url:u, seenAt:now, serverLastModified:null, classification:classifyUrlForLog(pageHost,u) }); });
          dC.added.forEach(u=>{ log = pushLog(log,{ type:"CSS added", url:u, seenAt:now, serverLastModified:null, classification:classifyUrlForLog(pageHost,u) }); });
          dC.removed.forEach(u=>{ log = pushLog(log,{ type:"CSS removed", url:u, seenAt:now, serverLastModified:null, classification:classifyUrlForLog(pageHost,u) }); });
        }

        // server-side header check (best effort) for page + up to 20 assets
        const targets = [url, ...(next.scripts||[]), ...(next.styles||[])].slice(0, 21);
        const metaPrev = (prev && prev.meta) ? prev.meta : {};
        const metaNext = {};
        for (const u of targets) {
          const m = await headMeta(u);
          metaNext[u] = { lastModified: m.lastModified, etag: m.etag };
          const old = metaPrev[u];
          if (old && (old.etag !== m.etag || old.lastModified !== m.lastModified) && (m.lastModified || m.etag)) {
            log = pushLog(log, {
              type: (u===url) ? "Page updated" : "Asset updated",
              url: u,
              seenAt: new Date().toISOString(),
              serverLastModified: m.lastModified,
              classification: classifyUrlForLog(pageHost,u)
            });
          }
        }
        next.meta = metaNext;

        await chrome.storage.local.set({ [key]: next, [CHANGELOG_KEY]: log });
        sendResponse({ ok: true });
        return;
      }
      
      if (msg?.type === "NAVIGATION") { 
        chrome.runtime.sendMessage(msg).catch(() => {}); 
        return; 
      }
      
      sendResponse({ ok: false });
    } catch (error) {
      logError('onMessage', error);
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true;
});

