// contrast-checker.js — WCAG 2.1 Color Contrast Checker
'use strict';

// ── Color math ────────────────────────────────────────────────────────

function hexToRgb(hex) {
  hex = hex.replace(/^#/, '').trim();
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return [0, 0, 50];
  const [r, g, b] = rgb.map(c => c / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}

function linearize(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(l1, l2) {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

// ── State ─────────────────────────────────────────────────────────────

let fgHex = '#000000';
let bgHex = '#ffffff';
let fgAlpha = 1.0;
let fgH = 0, fgS = 0, fgL = 0;
let bgH = 0, bgS = 0, bgL = 100;

function syncFgHsl() { [fgH, fgS, fgL] = hexToHsl(fgHex); }
function syncBgHsl() { [bgH, bgS, bgL] = hexToHsl(bgHex); }

syncFgHsl();
syncBgHsl();

// ── Helpers ───────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const ICON_PASS = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_FAIL = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

function setSliderGradient(slider, h, s) {
  const mid = `hsl(${h}, ${Math.max(s, 55)}%, 50%)`;
  slider.style.background = `linear-gradient(to right, #000000, ${mid}, #ffffff)`;
}

function updateFgSlider() {
  const slider = $('ccFgLight');
  if (!slider) return;
  slider.value = fgL;
  setSliderGradient(slider, fgH, fgS);
}

function updateBgSlider() {
  const slider = $('ccBgLight');
  if (!slider) return;
  slider.value = bgL;
  setSliderGradient(slider, bgH, bgS);
}

// ── Render ────────────────────────────────────────────────────────────

function render() {
  const fgRgb = hexToRgb(fgHex);
  const bgRgb = hexToRgb(bgHex);
  if (!fgRgb || !bgRgb) return;

  const alpha = Math.max(0, Math.min(1, fgAlpha));

  // Alpha-composite FG over BG for accurate contrast calculation
  const compRgb = fgRgb.map((c, i) => Math.round(c * alpha + bgRgb[i] * (1 - alpha)));

  const fgLum = relativeLuminance(...compRgb);
  const bgLum = relativeLuminance(...bgRgb);
  const ratio = contrastRatio(fgLum, bgLum);

  // Sync native pickers
  const fgPicker = $('ccFgPicker'); if (fgPicker) fgPicker.value = fgHex;
  const bgPicker = $('ccBgPicker'); if (bgPicker) bgPicker.value = bgHex;

  // Live preview
  const inner = $('ccPreviewInner');
  if (inner) {
    inner.style.background = bgHex;
    inner.style.color = alpha < 1
      ? `rgba(${fgRgb[0]},${fgRgb[1]},${fgRgb[2]},${alpha})`
      : fgHex;
  }
  const uiBtn = $('ccUiBtn');
  if (uiBtn) { uiBtn.style.borderColor = fgHex; uiBtn.style.color = fgHex; }
  const uiIcon = $('ccUiIcon');
  if (uiIcon) uiIcon.style.color = fgHex;

  // Ratio
  const display = ratio >= 21 ? '21.00' : ratio.toFixed(2);
  const ratioNum = $('ccRatioNum');
  if (ratioNum) ratioNum.innerHTML = `${display}<span class="cc-ratio-colon">:1</span>`;

  // Badge
  let badgeCls, badgeTxt, cardCls;
  if (ratio >= 7)        { badgeCls = 'aaa';     badgeTxt = 'AAA';      cardCls = 'pass';    }
  else if (ratio >= 4.5) { badgeCls = 'aa';      badgeTxt = 'AA';       cardCls = 'pass';    }
  else if (ratio >= 3)   { badgeCls = 'partial'; badgeTxt = 'AA Large'; cardCls = 'partial'; }
  else                   { badgeCls = 'fail';    badgeTxt = 'FAIL';     cardCls = 'fail';    }

  const badge = $('ccRatioBadge');
  if (badge) { badge.textContent = badgeTxt; badge.className = `cc-ratio-badge cc-badge--${badgeCls}`; }
  const card = $('ccRatioCard');
  if (card) card.className = `cc-ratio-card ${cardCls}`;

  // Luminance
  const fgLumEl = $('ccFgLum'); if (fgLumEl) fgLumEl.textContent = fgLum.toFixed(4);
  const bgLumEl = $('ccBgLum'); if (bgLumEl) bgLumEl.textContent = bgLum.toFixed(4);

  // WCAG checks
  const checks = [
    { id: 'wcagAaNormal',  thresh: 4.5 },
    { id: 'wcagAaLarge',   thresh: 3   },
    { id: 'wcagAaaNormal', thresh: 7   },
    { id: 'wcagAaaLarge',  thresh: 4.5 },
    { id: 'wcagUi',        thresh: 3   }
  ];

  checks.forEach(({ id, thresh }) => {
    const pass = ratio >= thresh;
    const el = $(id);
    const icon = $(id + 'Icon');
    const verdict = $(id + 'V');
    if (el) el.className = el.className.replace(/ pass| fail/g, '') + (pass ? ' pass' : ' fail');
    if (icon) icon.innerHTML = pass ? ICON_PASS : ICON_FAIL;
    if (verdict) verdict.textContent = pass ? 'Pass' : 'Fail';
  });

  // Update sliders
  updateFgSlider();
  updateBgSlider();
}

// ── Input binding ─────────────────────────────────────────────────────

function isValidHex(val) { return /^#?[0-9a-fA-F]{6}$/.test(val.trim()); }
function normalizeHex(val) { val = val.trim(); return val.startsWith('#') ? val : '#' + val; }

function bindInputs() {
  const fgPicker  = $('ccFgPicker');
  const bgPicker  = $('ccBgPicker');
  const fgHexInp  = $('ccFgHex');
  const bgHexInp  = $('ccBgHex');
  const fgLight   = $('ccFgLight');
  const bgLight   = $('ccBgLight');
  const fgAlphaEl = $('ccFgAlpha');
  const swapBtn   = $('ccSwap');
  const webaimBtn = $('ccWebAim');

  // FG color picker
  if (fgPicker) {
    fgPicker.addEventListener('input', () => {
      fgHex = fgPicker.value;
      syncFgHsl();
      if (fgHexInp) fgHexInp.value = fgHex;
      render();
    });
  }

  // BG color picker
  if (bgPicker) {
    bgPicker.addEventListener('input', () => {
      bgHex = bgPicker.value;
      syncBgHsl();
      if (bgHexInp) bgHexInp.value = bgHex;
      render();
    });
  }

  // FG hex input
  if (fgHexInp) {
    fgHexInp.addEventListener('input', () => {
      if (isValidHex(fgHexInp.value)) {
        fgHex = normalizeHex(fgHexInp.value);
        syncFgHsl();
        render();
      }
    });
    fgHexInp.addEventListener('blur', () => { fgHexInp.value = fgHex; });
  }

  // BG hex input
  if (bgHexInp) {
    bgHexInp.addEventListener('input', () => {
      if (isValidHex(bgHexInp.value)) {
        bgHex = normalizeHex(bgHexInp.value);
        syncBgHsl();
        render();
      }
    });
    bgHexInp.addEventListener('blur', () => { bgHexInp.value = bgHex; });
  }

  // FG lightness slider
  if (fgLight) {
    fgLight.addEventListener('input', () => {
      fgL = parseInt(fgLight.value);
      fgHex = hslToHex(fgH, fgS, fgL);
      if (fgPicker) fgPicker.value = fgHex;
      if (fgHexInp) fgHexInp.value = fgHex;
      setSliderGradient(fgLight, fgH, fgS);
      render();
    });
  }

  // BG lightness slider
  if (bgLight) {
    bgLight.addEventListener('input', () => {
      bgL = parseInt(bgLight.value);
      bgHex = hslToHex(bgH, bgS, bgL);
      if (bgPicker) bgPicker.value = bgHex;
      if (bgHexInp) bgHexInp.value = bgHex;
      setSliderGradient(bgLight, bgH, bgS);
      render();
    });
  }

  // FG alpha
  if (fgAlphaEl) {
    fgAlphaEl.addEventListener('input', () => {
      const v = parseFloat(fgAlphaEl.value);
      if (!isNaN(v)) fgAlpha = Math.max(0, Math.min(1, v));
      render();
    });
    fgAlphaEl.addEventListener('blur', () => {
      fgAlphaEl.value = fgAlpha.toFixed(2);
    });
  }

  // Swap
  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      [fgHex, bgHex] = [bgHex, fgHex];
      syncFgHsl(); syncBgHsl();
      if (fgHexInp) fgHexInp.value = fgHex;
      if (bgHexInp) bgHexInp.value = bgHex;
      if (fgPicker) fgPicker.value = fgHex;
      if (bgPicker) bgPicker.value = bgHex;
      swapBtn.classList.add('spinning');
      setTimeout(() => swapBtn.classList.remove('spinning'), 300);
      render();
    });
  }

  // WebAIM link
  if (webaimBtn) {
    webaimBtn.addEventListener('click', () => {
      const fg = fgHex.replace('#', '');
      const bg = bgHex.replace('#', '');
      chrome.tabs.create({ url: `https://webaim.org/resources/contrastchecker/?fcolor=${fg}&bcolor=${bg}` });
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────

function initContrastChecker() {
  bindInputs();
  render();
}

document.addEventListener('DOMContentLoaded', initContrastChecker);
