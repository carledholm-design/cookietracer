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

// ── Helpers ───────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const ICON_PASS = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const ICON_FAIL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

// ── Render ────────────────────────────────────────────────────────────

function render() {
  const fgRgb = hexToRgb(fgHex);
  const bgRgb = hexToRgb(bgHex);
  if (!fgRgb || !bgRgb) return;

  const fgL = relativeLuminance(...fgRgb);
  const bgL = relativeLuminance(...bgRgb);
  const ratio = contrastRatio(fgL, bgL);

  // Sync pickers
  const fgPicker = $('ccFgPicker'); if (fgPicker) fgPicker.value = fgHex;
  const bgPicker = $('ccBgPicker'); if (bgPicker) bgPicker.value = bgHex;

  // Live preview
  const inner = $('ccPreviewInner');
  if (inner) {
    inner.style.background = bgHex;
    inner.style.color = fgHex;
  }
  const uiBtn = $('ccUiBtn');
  if (uiBtn) { uiBtn.style.borderColor = fgHex; uiBtn.style.color = fgHex; }
  const uiIcon = $('ccUiIcon');
  if (uiIcon) uiIcon.style.color = fgHex;

  // Ratio number
  const display = ratio >= 21 ? '21.00' : ratio.toFixed(2);
  const ratioNum = $('ccRatioNum');
  if (ratioNum) ratioNum.innerHTML = `${display}<span class="cc-ratio-colon">:1</span>`;

  // Badge + card state
  let badgeCls, badgeTxt, cardCls;
  if (ratio >= 7)       { badgeCls = 'aaa';     badgeTxt = 'AAA';      cardCls = 'pass';    }
  else if (ratio >= 4.5){ badgeCls = 'aa';      badgeTxt = 'AA';       cardCls = 'pass';    }
  else if (ratio >= 3)  { badgeCls = 'partial'; badgeTxt = 'AA Large'; cardCls = 'partial'; }
  else                  { badgeCls = 'fail';    badgeTxt = 'Fail';     cardCls = 'fail';    }

  const badge = $('ccRatioBadge');
  if (badge) { badge.textContent = badgeTxt; badge.className = `cc-ratio-badge cc-badge--${badgeCls}`; }

  const card = $('ccRatioCard');
  if (card) card.className = `cc-ratio-card ${cardCls}`;

  // Luminance
  const fgLumEl = $('ccFgLum'); if (fgLumEl) fgLumEl.textContent = fgL.toFixed(4);
  const bgLumEl = $('ccBgLum'); if (bgLumEl) bgLumEl.textContent = bgL.toFixed(4);

  // WCAG cards
  const checks = [
    { id: 'wcagAaNormal', thresh: 4.5 },
    { id: 'wcagAaLarge',  thresh: 3   },
    { id: 'wcagAaaNormal',thresh: 7   },
    { id: 'wcagAaaLarge', thresh: 4.5 },
    { id: 'wcagUi',       thresh: 3   }
  ];

  checks.forEach(({ id, thresh }) => {
    const pass = ratio >= thresh;
    const el = $(id);
    const icon = $(id + 'Icon');
    const verdict = $(id + 'V');
    if (el) {
      el.className = el.className.replace(/ pass| fail/g, '') + (pass ? ' pass' : ' fail');
    }
    if (icon) icon.innerHTML = pass ? ICON_PASS : ICON_FAIL;
    if (verdict) verdict.textContent = pass ? 'Pass' : 'Fail';
  });
}

// ── Input binding ─────────────────────────────────────────────────────

function isValidHex(val) {
  return /^#?[0-9a-fA-F]{6}$/.test(val.trim());
}

function normalizeHex(val) {
  val = val.trim();
  return val.startsWith('#') ? val : '#' + val;
}

function bindInputs() {
  const fgPicker  = $('ccFgPicker');
  const bgPicker  = $('ccBgPicker');
  const fgHexInp  = $('ccFgHex');
  const bgHexInp  = $('ccBgHex');
  const swapBtn   = $('ccSwap');

  if (fgPicker) {
    fgPicker.addEventListener('input', () => {
      fgHex = fgPicker.value;
      if (fgHexInp) fgHexInp.value = fgHex;
      render();
    });
  }

  if (bgPicker) {
    bgPicker.addEventListener('input', () => {
      bgHex = bgPicker.value;
      if (bgHexInp) bgHexInp.value = bgHex;
      render();
    });
  }

  if (fgHexInp) {
    fgHexInp.addEventListener('input', () => {
      const v = fgHexInp.value;
      if (isValidHex(v)) { fgHex = normalizeHex(v); render(); }
    });
    fgHexInp.addEventListener('blur', () => {
      fgHexInp.value = fgHex;
    });
  }

  if (bgHexInp) {
    bgHexInp.addEventListener('input', () => {
      const v = bgHexInp.value;
      if (isValidHex(v)) { bgHex = normalizeHex(v); render(); }
    });
    bgHexInp.addEventListener('blur', () => {
      bgHexInp.value = bgHex;
    });
  }

  if (swapBtn) {
    swapBtn.addEventListener('click', () => {
      [fgHex, bgHex] = [bgHex, fgHex];
      if (fgHexInp) fgHexInp.value = fgHex;
      if (bgHexInp) bgHexInp.value = bgHex;
      if (fgPicker) fgPicker.value = fgHex;
      if (bgPicker) bgPicker.value = bgHex;
      swapBtn.classList.add('spinning');
      setTimeout(() => swapBtn.classList.remove('spinning'), 300);
      render();
    });
  }
}

// ── Init ──────────────────────────────────────────────────────────────

function initContrastChecker() {
  bindInputs();
  render();
}

document.addEventListener('DOMContentLoaded', initContrastChecker);
