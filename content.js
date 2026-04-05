(function(){
  // Cookie Tracer+ Content Script
  // Version 1.9.2 - Enhanced error handling and stability
  
  async function collectAssets(){
    // Collect ALL resources loaded on the page (URLs only, no HEAD requests to avoid CORS errors)
    const scriptElements = Array.from(document.scripts || []).filter(s => s.src);
    const styleElements = Array.from(document.querySelectorAll('link[rel="stylesheet"]') || []).filter(l => l.href);
    
    const scriptsWithDates = scriptElements.map(s => ({ url: s.src, lastModified: null }));
    const stylesWithDates = styleElements.map(l => ({ url: l.href, lastModified: null }));
    
    // Get images
    const images = Array.from(document.images || []).map(img => img.src).filter(Boolean);
    
    // Get iframes
    const iframes = Array.from(document.querySelectorAll('iframe') || []).map(f => f.src).filter(Boolean);
    
    // Get video/audio sources
    const media = Array.from(document.querySelectorAll('video, audio') || []).map(m => m.src).filter(Boolean);
    const mediaSources = Array.from(document.querySelectorAll('video source, audio source') || []).map(s => s.src).filter(Boolean);
    
    // Get preload/prefetch resources
    const preloads = Array.from(document.querySelectorAll('link[rel="preload"], link[rel="prefetch"]') || []).map(l => l.href).filter(Boolean);
    
    // Get font resources
    const fonts = Array.from(document.querySelectorAll('link[rel="preload"][as="font"], link[href*=".woff"], link[href*=".woff2"]') || []).map(l => l.href).filter(Boolean);

    return {
      scripts: scriptsWithDates,
      styles: stylesWithDates,
      images: images,
      iframes: iframes,
      media: [...media, ...mediaSources],
      preloads: preloads,
      fonts: fonts,
      href: window.location.href
    };
  }

  // --- OneTrust cookie banner hide ---
  // All banner hiding handled by banner-blocker.js (CSS-only, class toggle).
  // No MutationObserver, no DOM removal, no button clicking in content.js.
  let hideCookieBannerEnabled = false;

  try {
    chrome.storage.sync.get("hideCookieBanner", ({ hideCookieBanner }) => {
      hideCookieBannerEnabled = hideCookieBanner === true;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.hideCookieBanner) {
        hideCookieBannerEnabled = changes.hideCookieBanner.newValue === true;
      }
    });
  } catch (error) {
    // Extension context invalidated
  }

  // Extracts visible body text for reading-level analysis
  function extractVisibleText() {
    const SKIP = new Set(['script','style','noscript','nav','header','footer',
                          'svg','iframe','button','select','option','input','textarea']);
    const BLOCK = new Set(['p','h1','h2','h3','h4','h5','h6','li','td','th',
                           'div','section','article','blockquote','figcaption']);
    function walk(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.replace(/\s+/g, ' ').trim();
        return t ? t + ' ' : '';
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = (node.tagName || '').toLowerCase();
      if (SKIP.has(tag)) return '';
      try {
        const s = window.getComputedStyle(node);
        if (s.display === 'none' || s.visibility === 'hidden') return '';
      } catch (e) {}
      let out = '';
      for (const child of node.childNodes) out += walk(child);
      if (BLOCK.has(tag) && out.trim()) out = out.trim() + '. ';
      return out;
    }
    const root = document.querySelector('main, [role="main"], #main-content, .main-content, article') || document.body;
    return walk(root).replace(/\s+/g, ' ').replace(/\.\s*\./g, '.').trim();
  }

  // Receive explicit close request with better error handling
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (msg && msg.type === "PING") {
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === "COLLECT_ASSETS") {
        // Make async to support timestamp fetching
        collectAssets().then(assets => {
          sendResponse(assets);
        }).catch(error => {
          // console.error('[Cookie Tracer+] Error collecting assets:', error);
          sendResponse({ scripts: [], styles: [], images: [], iframes: [], media: [], preloads: [], fonts: [], href: window.location.href });
        });
        return true; // Keep channel open for async response
      }
      if (msg && msg.type === "CLOSE_COOKIE_BANNER") {
        // Banner hiding handled by banner-blocker.js CSS injection
        sendResponse({ ok: true });
        return true;
      }
      if (msg && msg.type === "EXTRACT_TEXT") {
        try { sendResponse({ text: extractVisibleText() }); }
        catch (e) { sendResponse({ text: '' }); }
        return true;
      }
    } catch (error) {
      // console.error('[Cookie Tracer+] Message handler error:', error);
      sendResponse({ ok: false, error: error.message });
    }
    return false;
  });

  // SPA navigation notifications - MUST be completely safe, never interfere with page
  const sendRoute = () => { 
    try { 
      chrome.runtime.sendMessage({ type: "ROUTE_CHANGE", url: location.href }).catch(() => {}); 
    } catch(e) {
      // Silently fail - extension context may be invalidated
    } 
  };
  const _pushState = history.pushState; 
  history.pushState = function(){ 
    const result = _pushState.apply(this, arguments); 
    try { sendRoute(); } catch {} 
    return result; 
  };
  const _replaceState = history.replaceState; 
  history.replaceState = function(){ 
    const result = _replaceState.apply(this, arguments); 
    try { sendRoute(); } catch {} 
    return result; 
  };
  window.addEventListener("popstate", sendRoute);
  window.addEventListener("hashchange", sendRoute);
})();
