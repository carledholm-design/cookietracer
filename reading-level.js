// reading-level.js — Flesch-Kincaid Reading Level Analyzer
'use strict';

function rlCountSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const m = word.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}

function rlAnalyzeText(text) {
  if (!text || text.trim().length < 20) return null;
  const sentenceMatches = text.match(/[^.!?]+[.!?]+/g) || [text];
  const sentences = sentenceMatches.filter(s => s.trim().length > 3);
  const sentenceCount = Math.max(1, sentences.length);
  const words = text.match(/\b[a-zA-Z']+\b/g) || [];
  const wordCount = Math.max(1, words.length);
  const syllableCount = words.reduce((sum, w) => sum + rlCountSyllables(w), 0);
  const wps = wordCount / sentenceCount;
  const spw = syllableCount / wordCount;
  const grade = Math.max(0, 0.39 * wps + 11.8 * spw - 15.59);
  const ease  = Math.min(100, Math.max(0, 206.835 - 1.015 * wps - 84.6 * spw));
  return {
    grade: Math.round(grade * 10) / 10,
    ease:  Math.round(ease  * 10) / 10,
    wordCount,
    sentenceCount,
    wps: Math.round(wps * 10) / 10
  };
}

function rlGradeInfo(grade) {
  if (grade <= 6)  return { label: 'Elementary',   note: 'Grade 5–6, ages 10–12',   status: 'pass' };
  if (grade <= 8)  return { label: 'Middle School', note: 'Grade 7–8, ages 12–14',   status: 'pass' };
  if (grade <= 10) return { label: 'High School',   note: 'Grade 9–10, ages 14–16',  status: 'warn' };
  if (grade <= 12) return { label: 'Senior High',   note: 'Grade 11–12, ages 16–18', status: 'warn' };
  return               { label: 'College Level',   note: 'Above Grade 12',           status: 'fail' };
}

function rlEaseLabel(ease) {
  if (ease >= 90) return 'Very Easy';
  if (ease >= 80) return 'Easy';
  if (ease >= 70) return 'Fairly Easy';
  if (ease >= 60) return 'Standard';
  if (ease >= 50) return 'Fairly Difficult';
  if (ease >= 30) return 'Difficult';
  return 'Very Difficult';
}

(function initReadingLevel() {
  const panel = document.getElementById('content-readinglevel');
  if (!panel) return;

  const analyzeBtn  = document.getElementById('rlAnalyzeBtn');
  const statusEl    = document.getElementById('rlStatus');
  const resultsEl   = document.getElementById('rlResults');
  const gradeNumEl  = document.getElementById('rlGradeNum');
  const gradeLblEl  = document.getElementById('rlGradeLabel');
  const gradeNoteEl = document.getElementById('rlGradeNote');
  const easeNumEl   = document.getElementById('rlEaseNum');
  const easeLblEl   = document.getElementById('rlEaseLabel');
  const wordCntEl   = document.getElementById('rlWordCount');
  const sentCntEl   = document.getElementById('rlSentCount');
  const wpsEl       = document.getElementById('rlWps');
  const pharmaEl    = document.getElementById('rlPharmaNote');
  const pageUrlEl   = document.getElementById('rlPageUrl');

  if (!analyzeBtn) return;

  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'rl-status' + (cls ? ' ' + cls : '');
  }

  function resetTool() {
    if (resultsEl) resultsEl.classList.add('hidden');
    if (pharmaEl)  pharmaEl.classList.add('hidden');
    if (pageUrlEl) pageUrlEl.textContent = '';
    setStatus('');
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Analyze Page';
  }

  async function getActiveTab() {
    return new Promise(resolve => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
        resolve(tabs && tabs.length ? tabs[0] : null);
      });
    });
  }

  async function runAnalysis() {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing…';
    setStatus('');
    if (resultsEl) resultsEl.classList.add('hidden');

    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      setStatus('Could not detect the active tab.', 'warn');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze Page';
      return;
    }

    let text = '';
    try {
      const resp = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 6000);
        chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TEXT' }, r => {
          clearTimeout(t);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      text = resp?.text || '';
    } catch (e) {
      setStatus('Could not read page text. Try refreshing the page.', 'fail');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze Page';
      return;
    }

    if (!text || text.length < 50) {
      setStatus('Not enough text found on this page.', 'warn');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze Page';
      return;
    }

    const stats = rlAnalyzeText(text);
    if (!stats) {
      setStatus('Analysis failed — try again.', 'fail');
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = 'Analyze Page';
      return;
    }

    const gi = rlGradeInfo(stats.grade);
    const el = rlEaseLabel(stats.ease);

    if (gradeNumEl)  gradeNumEl.textContent = stats.grade.toFixed(1);
    if (gradeLblEl)  { gradeLblEl.textContent = gi.label; gradeLblEl.className = 'rl-grade-label rl-' + gi.status; }
    if (gradeNoteEl) gradeNoteEl.textContent = gi.note;
    if (easeNumEl)   easeNumEl.textContent = stats.ease.toFixed(0);
    if (easeLblEl)   easeLblEl.textContent = el;
    if (wordCntEl)   wordCntEl.textContent = stats.wordCount.toLocaleString();
    if (sentCntEl)   sentCntEl.textContent = stats.sentenceCount.toLocaleString();
    if (wpsEl)       wpsEl.textContent = stats.wps;

    if (pageUrlEl && tab.url) {
      try {
        const u = new URL(tab.url);
        pageUrlEl.textContent = u.hostname + u.pathname;
      } catch (e) {
        pageUrlEl.textContent = tab.url;
      }
    }

    if (pharmaEl) {
      if (stats.grade > 8) {
        pharmaEl.textContent = 'FDA guidance recommends patient materials target Grade 6–8. This page reads above that threshold.';
        pharmaEl.className = 'rl-pharma-note warn';
      } else {
        pharmaEl.textContent = 'Reading level is within FDA-recommended range for patient materials (Grade 6–8).';
        pharmaEl.className = 'rl-pharma-note pass';
      }
      pharmaEl.classList.remove('hidden');
    }

    setStatus('');
    if (resultsEl) resultsEl.classList.remove('hidden');
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Re-analyze';
  }

  analyzeBtn.addEventListener('click', runAnalysis);

  // ── Reset on navigation or tab switch ──────────────────────────────
  // When the active tab navigates to a new URL, clear stale results
  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.status === 'loading') {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs && tabs[0] && tabs[0].id === tabId) resetTool();
        });
      }
    });

    // When the user switches to a different tab, also reset
    chrome.tabs.onActivated.addListener(() => resetTool());
  } catch (e) {}
})();
