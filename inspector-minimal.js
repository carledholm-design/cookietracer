// Cookie Tracer+ Inspector - Minimal Build
// Removed: Change Log, Dependencies section, CSV Export

const el = (id) => document.getElementById(id);

// State tracking
const state = {
  trackedUrl: null,
  trackedTabId: null,
  trackedTitle: null,
  currentData: { js: [], css: [], cookies: [] },
  detectedConditions: { hd: false, td: false }
};

// Keep only: Overview tab, Journey Cookies, Toast system, Screenshots, Pin/Unpin

