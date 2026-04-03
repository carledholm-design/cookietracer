// Cookie Tracer+ Banner Blocker
// CSS is ALWAYS injected. Activation controlled by .ct-hide-banners class on <html>.
// This means the CSS rules are ready the instant OneTrust injects its elements.
(function(){
  const STYLE_ID = "ct-hide-onetrust-style";

  // Inject CSS immediately â€” it only applies when html.ct-hide-banners is set
  function injectStyle(){
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.ct-hide-banners #onetrust-consent-sdk {
        display: none !important;
        height: 0 !important; max-height: 0 !important; min-height: 0 !important;
        width: 0 !important; padding: 0 !important; margin: 0 !important;
        overflow: hidden !important; position: fixed !important;
        top: -9999px !important; left: -9999px !important;
        opacity: 0 !important; visibility: hidden !important;
        pointer-events: none !important; z-index: -1 !important;
      }
      html.ct-hide-banners #onetrust-banner-sdk,
      html.ct-hide-banners #onetrust-pc-sdk,
      html.ct-hide-banners .onetrust-pc-dark-filter,
      html.ct-hide-banners [id^="onetrust-"],
      html.ct-hide-banners [class*="onetrust-"],
      html.ct-hide-banners .ot-sdk-container,
      html.ct-hide-banners .ot-sdk-row,
      html.ct-hide-banners .ot-fade-in,
      html.ct-hide-banners .ot-fade-out,
      html.ct-hide-banners [class^="ot-sdk-"],
      html.ct-hide-banners .ot-sdk-show-settings,
      html.ct-hide-banners .ot-floating-button,
      html.ct-hide-banners #ot-sdk-btn-floating,
      html.ct-hide-banners .optanon-alert-box-wrapper,
      html.ct-hide-banners #optanon-popup-bg {
        display: none !important; visibility: hidden !important;
        height: 0 !important; max-height: 0 !important;
        padding: 0 !important; margin: 0 !important;
        overflow: hidden !important; pointer-events: none !important;
      }
      html.ct-hide-banners body { top: 0 !important; position: static !important; }
      html.ct-hide-banners body.ot-overflow-hidden { overflow: auto !important; }
    `;
    if (document.head) {
      document.head.appendChild(style);
    } else {
      new MutationObserver((_, obs) => {
        if (document.head) { document.head.appendChild(style); obs.disconnect(); }
      }).observe(document.documentElement, { childList: true });
    }
  }

  function setActive(enabled) {
    if (enabled) {
      document.documentElement.classList.add("ct-hide-banners");
    } else {
      document.documentElement.classList.remove("ct-hide-banners");
    }
  }

  // Always inject the CSS
  injectStyle();

  try {
    chrome.storage.sync.get("hideCookieBanner", ({ hideCookieBanner }) => {
      setActive(hideCookieBanner === true);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.hideCookieBanner) {
        setActive(changes.hideCookieBanner.newValue === true);
      }
    });
  } catch (e) {
    // Extension context invalidated
  }
})();
