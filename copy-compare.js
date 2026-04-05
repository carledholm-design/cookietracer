// copy-compare.js — Word-for-word copy comparison tool for Edit
'use strict';

// ── Text normalization ────────────────────────────────────────────────
function cc2Normalize(text) {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // smart single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')    // smart double quotes
    .replace(/[\u2013\u2014]/g, '-')                // en/em dash
    .replace(/\u00A0/g, ' ')                        // non-breaking space
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ── Tokenize into words only (for diffing) ────────────────────────────
function cc2Words(text) {
  return text.match(/\S+/g) || [];
}

// ── LCS-based word diff ───────────────────────────────────────────────
// Returns array of ops: { type: 'eq'|'del'|'add', a?, b? }
// 'del' = word in page (A) but not in approved (B)
// 'add' = word in approved (B) but not in page (A)
function cc2Diff(wordsA, wordsB) {
  const m = Math.min(wordsA.length, 2000);
  const n = Math.min(wordsB.length, 2000);
  const A = wordsA.slice(0, m);
  const B = wordsB.slice(0, n);

  // Flat DP array
  const W = n + 1;
  const dp = new Int32Array((m + 1) * W);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (A[i-1].toLowerCase() === B[j-1].toLowerCase()) {
        dp[i * W + j] = dp[(i-1) * W + (j-1)] + 1;
      } else {
        const up   = dp[(i-1) * W + j];
        const left = dp[i * W + (j-1)];
        dp[i * W + j] = up > left ? up : left;
      }
    }
  }

  // Backtrack
  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i-1].toLowerCase() === B[j-1].toLowerCase()) {
      ops.push({ type: 'eq', a: A[i-1], b: B[j-1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i * W + (j-1)] >= dp[(i-1) * W + j])) {
      ops.push({ type: 'add', b: B[j-1] });
      j--;
    } else {
      ops.push({ type: 'del', a: A[i-1] });
      i--;
    }
  }
  ops.reverse();
  return ops;
}

// ── HTML escape ───────────────────────────────────────────────────────
function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Render approved copy view (highlights words missing from page) ────
function cc2RenderApproved(ops) {
  let html = '';
  for (const op of ops) {
    if (op.type === 'eq')  html += esc(op.b) + ' ';
    if (op.type === 'add') html += `<mark class="cc2-miss">${esc(op.b)}</mark> `;
  }
  return html.trim();
}

// ── Render page text view (highlights words not in approved copy) ─────
function cc2RenderPage(ops) {
  let html = '';
  for (const op of ops) {
    if (op.type === 'eq')  html += esc(op.a) + ' ';
    if (op.type === 'del') html += `<mark class="cc2-extra">${esc(op.a)}</mark> `;
  }
  return html.trim();
}

// ── Init ──────────────────────────────────────────────────────────────
(function initCopyCompare() {
  const panel = document.getElementById('content-copycompare');
  if (!panel) return;

  const textarea   = document.getElementById('cc2ApprovedText');
  const compareBtn = document.getElementById('cc2CompareBtn');
  const clearBtn   = document.getElementById('cc2ClearBtn');
  const statusEl   = document.getElementById('cc2Status');
  const resultsEl  = document.getElementById('cc2Results');
  const summaryEl  = document.getElementById('cc2Summary');
  const approvedVw = document.getElementById('cc2ApprovedView');
  const pageVw     = document.getElementById('cc2PageView');

  if (!compareBtn) return;

  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = 'cc2-status' + (cls ? ' ' + cls : '');
  }

  function reset() {
    if (textarea)  textarea.value = '';
    if (resultsEl) resultsEl.classList.add('hidden');
    setStatus('');
    compareBtn.disabled = false;
    compareBtn.textContent = 'Compare with Page';
  }

  if (clearBtn) clearBtn.addEventListener('click', reset);

  compareBtn.addEventListener('click', async () => {
    const approved = cc2Normalize(textarea?.value || '');
    if (!approved || approved.length < 5) {
      setStatus('Paste the approved copy first.', 'warn');
      return;
    }

    compareBtn.disabled = true;
    compareBtn.textContent = 'Comparing…';
    setStatus('');
    if (resultsEl) resultsEl.classList.add('hidden');

    // Get active tab in the last focused browser window (not the inspector window)
    const tab = await new Promise(resolve => {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => resolve(tabs?.[0] || null));
    });
    if (!tab?.id) {
      setStatus('Could not detect the active tab.', 'warn');
      compareBtn.disabled = false;
      compareBtn.textContent = 'Compare with Page';
      return;
    }

    // Extract page text
    let pageText = '';
    try {
      const resp = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 6000);
        chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TEXT' }, r => {
          clearTimeout(t);
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(r);
        });
      });
      pageText = cc2Normalize(resp?.text || '');
    } catch (e) {
      setStatus('Could not read page text. Try refreshing the page.', 'fail');
      compareBtn.disabled = false;
      compareBtn.textContent = 'Compare with Page';
      return;
    }

    if (!pageText || pageText.length < 10) {
      setStatus('Not enough text found on the page.', 'warn');
      compareBtn.disabled = false;
      compareBtn.textContent = 'Compare with Page';
      return;
    }

    // Run diff
    const wordsPage     = cc2Words(pageText);
    const wordsApproved = cc2Words(approved);
    const ops = cc2Diff(wordsPage, wordsApproved);

    const missing = ops.filter(o => o.type === 'add').length;
    const extra   = ops.filter(o => o.type === 'del').length;

    // Summary
    if (summaryEl) {
      if (missing === 0 && extra === 0) {
        summaryEl.innerHTML = `<span class="cc2-sum-pass">✓ No differences found</span>`;
      } else {
        const parts = [];
        if (missing > 0) parts.push(`<span class="cc2-sum-miss">${missing} word${missing !== 1 ? 's' : ''} missing from page</span>`);
        if (extra   > 0) parts.push(`<span class="cc2-sum-extra">${extra} word${extra !== 1 ? 's' : ''} not in approved copy</span>`);
        summaryEl.innerHTML = parts.join('<span class="cc2-sum-sep"> · </span>');
      }
    }

    if (approvedVw) approvedVw.innerHTML = cc2RenderApproved(ops);
    if (pageVw)     pageVw.innerHTML     = cc2RenderPage(ops);

    if (resultsEl) resultsEl.classList.remove('hidden');
    setStatus('');
    compareBtn.disabled = false;
    compareBtn.textContent = 'Re-compare';
  });

  // Reset when tab navigates
  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo.url || changeInfo.status === 'loading') {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs?.[0]?.id === tabId) {
            if (resultsEl) resultsEl.classList.add('hidden');
            setStatus('');
            compareBtn.disabled = false;
            compareBtn.textContent = 'Compare with Page';
          }
        });
      }
    });
    chrome.tabs.onActivated.addListener(() => {
      if (resultsEl) resultsEl.classList.add('hidden');
      setStatus('');
      compareBtn.disabled = false;
      compareBtn.textContent = 'Compare with Page';
    });
  } catch (e) {}
})();
