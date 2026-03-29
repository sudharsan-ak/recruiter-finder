// ── Jobs Panel ────────────────────────────────────────────────────────────────

const JOBS_STACK_KEY   = 'myJobStack';
const JOBS_RESULTS_KEY = 'jobScanResults';
const JOBS_STATE_KEY   = 'jobScanState';
const JOBS_MAX_KEY     = 'jobScanMax';

let _jobStack   = [];
let _jobResults = [];
let _jobState   = { running: false, total: 0, done: 0 };
let _selectedIds = new Set();
let _filterMatchingOnly = false;
let _visibleJobIds = null;
let _urlMismatch = false;
let _stackCollapsed = true;   // collapsed by default
let _maxJobs = 25;
let _expandedCardId = null;
let _collapseListener = null;
let _companyFilter = '';

const jobsMain = document.getElementById('jobsMain');

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchStack(jdText, stack) {
  if (!jdText || !stack.length) return [];
  return stack.filter(tag => {
    const pat = (typeof TECH_PATTERNS !== 'undefined')
      ? TECH_PATTERNS.find(([label]) => label === tag)
      : null;
    if (pat) return new RegExp(pat[1], pat[2]).test(jdText);
    return jdText.toLowerCase().includes(tag.toLowerCase());
  });
}

async function loadJobsData() {
  const d = await new Promise(r =>
    chrome.storage.local.get([JOBS_STACK_KEY, JOBS_RESULTS_KEY, JOBS_STATE_KEY, JOBS_MAX_KEY], r)
  );
  _jobStack   = d[JOBS_STACK_KEY]   || [];
  _jobResults = d[JOBS_RESULTS_KEY] || [];
  _jobState   = d[JOBS_STATE_KEY]   || { running: false, total: 0, done: 0 };
  _maxJobs    = d[JOBS_MAX_KEY]     ?? 25;
}

async function saveStack() {
  await chrome.storage.local.set({ [JOBS_STACK_KEY]: _jobStack });
}

async function findLinkedInJobsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/jobs/*' });
  return tabs[0] || null;
}

function normalizeJobUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('currentJobId');
    return u.origin + u.pathname + u.search;
  } catch { return url; }
}

// ── Scan control ──────────────────────────────────────────────────────────────

async function startScan() {
  const tab = await findLinkedInJobsTab();
  if (!tab) {
    _drawJobs({ error: 'No LinkedIn jobs page found. Navigate to linkedin.com/jobs first.' });
    return;
  }
  await chrome.storage.local.set({
    jobScanResults: [],
    jobScanState: { running: true, total: 0, done: 0, pageUrl: tab.url },
  });
  _jobResults = [];
  _jobState   = { running: true, total: 0, done: 0 };
  _selectedIds.clear();
  _drawJobs();
  try {
    chrome.tabs.sendMessage(tab.id, { action: 'startJobScan', maxJobs: _maxJobs }, () => { void chrome.runtime.lastError; });
  } catch {}
}

async function stopScan() {
  const tab = await findLinkedInJobsTab();
  if (tab) {
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'stopJobScan' }, () => { void chrome.runtime.lastError; });
    } catch {}
  }
}

// ── Copy action ───────────────────────────────────────────────────────────────

function copySelectedJDs() {
  const selected = _jobResults.filter(r => _selectedIds.has(r.jobId));
  if (!selected.length) return;
  const text = selected.map(r =>
    `=== ${r.title} @ ${r.company} ===\n${r.url}\n\n${r.jdText}`
  ).join('\n\n' + '─'.repeat(60) + '\n\n');
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── Render ────────────────────────────────────────────────────────────────────

function _drawJobs({ error } = {}) {
  const running = _jobState.running;
  const { total, done } = _jobState;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const allScored = _jobResults.map(r => ({
    ...r,
    matched: matchStack(r.jdText, _jobStack),
  })).sort((a, b) => b.matched.length - a.matched.length);

  const visibleScored = _visibleJobIds
    ? allScored.filter(r => _visibleJobIds.includes(r.jobId))
    : allScored;

  const matchingCount = visibleScored.filter(r => r.matched.length > 0).length;
  const scored = _filterMatchingOnly ? visibleScored.filter(r => r.matched.length > 0) : visibleScored;
  const selCount = _selectedIds.size;
  const hiddenCount = allScored.length - visibleScored.length;

  jobsMain.innerHTML = `
    <div class="jobs-stack-section">
      <div class="jobs-stack-header">
        <span class="jobs-section-label">MY STACK <span class="jobs-stack-count">(${_jobStack.length})</span></span>
        <button class="jobs-stack-toggle" id="jobsStackToggle">
          ${_stackCollapsed ? '▾ Edit' : '▴ Hide'}
        </button>
      </div>
      ${!_stackCollapsed ? `
        <div class="jobs-stack-tags" id="jobsStackTags">
          ${_jobStack.map(t => `
            <span class="jobs-stack-tag">
              ${t}<button class="jobs-tag-remove" data-tag="${t}">×</button>
            </span>`).join('')}
        </div>
        <div class="jobs-stack-input-row">
          <input type="text" id="jobsStackInput" placeholder="Add technology…" autocomplete="off" />
          <button id="jobsStackAddBtn">+ Add</button>
        </div>
      ` : ''}
    </div>

    <div class="jobs-scan-section">
      ${running ? `
        <button class="jobs-stop-btn" id="jobsStopBtn">⏹ Stop</button>
        <div class="jobs-progress-row">
          <div class="jobs-progress-bar"><div class="jobs-progress-fill" style="width:${pct}%"></div></div>
          <span class="jobs-progress-label">Scanning ${done} / ${total}</span>
        </div>
      ` : `
        <div class="jobs-scan-row">
          <button class="jobs-scan-btn" id="jobsScanBtn">▶ Scan Jobs</button>
          <span class="jobs-max-label">up to</span>
          <input type="number" id="jobsMaxInput" class="jobs-max-input" value="${_maxJobs}" min="1" max="500" />
          <span class="jobs-max-label">jobs</span>
          <div class="jobs-results-menu-wrap" style="margin-left:auto">
            <button class="jobs-menu-btn" id="jobsMenuBtn">≡ Options</button>
            <div class="jobs-menu-dropdown" id="jobsMenuDropdown" style="display:none">
              <button class="jobs-menu-item ${_filterMatchingOnly ? 'jobs-menu-item-active' : ''}" id="jobsFilterMatchBtn">
                ${_filterMatchingOnly ? '✓ Matching only' : '○ Matching only'}
              </button>
              <div class="jobs-menu-sep"></div>
              <button class="jobs-menu-item" id="jobsSelectMatchingBtn">Select Matching</button>
              <button class="jobs-menu-item" id="jobsCopyBtn" ${selCount === 0 ? 'disabled' : ''}>
                📋 Copy JDs${selCount ? ` (${selCount})` : ''}
              </button>
              <div class="jobs-menu-sep"></div>
              <button class="jobs-menu-item jobs-menu-item-danger" id="jobsClearResultsBtn">🗑 Clear Results</button>
            </div>
          </div>
        </div>
      `}
      ${_urlMismatch ? `
        <div class="jobs-warn">⚠ Search page has changed. Results below are from a previous scan.</div>
      ` : ''}
      ${error ? `<div class="jobs-error">${error}</div>` : ''}
    </div>

    ${allScored.length > 0 ? `
      ${hiddenCount > 0 && !_urlMismatch ? `
        <div class="jobs-page-note">Showing ${visibleScored.length} of ${allScored.length} scanned jobs visible on current page.</div>
      ` : ''}
      <div class="jobs-results-header">
        <span class="jobs-results-summary" id="jobsResultsSummary">
          ${scored.length} shown · ${matchingCount} match${selCount ? ` · ${selCount} selected` : ''}
        </span>
        <div class="jobs-results-header-right">
          ${selCount > 0 ? `<button class="jobs-clear-btn" id="jobsClearSelBtn">✕ Clear</button>` : ''}
        </div>
      </div>
      <div class="jobs-filter-bar-inner">
        <input type="text" id="jobsCompanyFilter" class="jobs-company-filter" placeholder="🔍 Filter by company…" autocomplete="off" value="${_companyFilter}" />
        <button id="jobsFilterClearBtn" class="jobs-filter-clear-btn" style="display:${_companyFilter ? '' : 'none'}">✕</button>
      </div>
      <div class="jobs-results-list">
        ${scored.map(r => {
          const sel = _selectedIds.has(r.jobId);
          const expanded = r.jobId === _expandedCardId;
          const score = r.matched.length;
          const stackLen = _jobStack.length;
          const scoreLabel = stackLen > 0
            ? `<span class="jobs-score ${score === 0 ? 'jobs-score-none' : score === stackLen ? 'jobs-score-full' : 'jobs-score-partial'}">${score}/${stackLen} match</span>`
            : '';
          return `
            <div class="jobs-result-card ${sel ? 'selected' : ''} ${expanded ? 'expanded' : ''}" data-id="${r.jobId}">
              <input type="checkbox" class="jobs-result-check" data-id="${r.jobId}" ${sel ? 'checked' : ''} />
              <div class="jobs-result-body">
                <div class="jobs-result-title">
                  <a href="${r.url}" target="_blank">${r.title || '(no title)'}</a>
                  <span class="jobs-result-company">${r.company || ''}</span>
                </div>
                <div class="jobs-result-meta">
                  ${scoreLabel}
                  ${expanded ? `
                    ${r.matched.map(t => `<span class="jobs-match-tag">${t}</span>`).join('')}
                    ${_jobStack.filter(t => !r.matched.includes(t)).map(t =>
                      `<span class="jobs-miss-tag">${t}</span>`).join('')}
                  ` : ''}
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    ` : (allScored.length === 0 && !running ? `
      <div class="jobs-empty">
        Navigate to a LinkedIn jobs search page, then click Scan.
      </div>
    ` : '')}
  `;

  // ── Wire events ──

  document.getElementById('jobsStackToggle')?.addEventListener('click', () => {
    _stackCollapsed = !_stackCollapsed;
    _drawJobs();
  });

  document.getElementById('jobsScanBtn')?.addEventListener('click', () => {
    // Save max before scan
    const inp = document.getElementById('jobsMaxInput');
    if (inp) {
      _maxJobs = Math.max(1, parseInt(inp.value) || 25);
      chrome.storage.local.set({ [JOBS_MAX_KEY]: _maxJobs });
    }
    startScan();
  });
  document.getElementById('jobsStopBtn')?.addEventListener('click', stopScan);

  document.getElementById('jobsMaxInput')?.addEventListener('change', (e) => {
    _maxJobs = Math.max(1, parseInt(e.target.value) || 25);
    chrome.storage.local.set({ [JOBS_MAX_KEY]: _maxJobs });
  });

  document.getElementById('jobsClearSelBtn')?.addEventListener('click', () => {
    _selectedIds.clear();
    _drawJobs();
  });

  const jobsMenuBtn = document.getElementById('jobsMenuBtn');
  const jobsMenuDropdown = document.getElementById('jobsMenuDropdown');
  jobsMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = jobsMenuDropdown.style.display !== 'none';
    jobsMenuDropdown.style.display = open ? 'none' : 'block';
  });
  document.addEventListener('click', function _closeJobsMenu() {
    if (jobsMenuDropdown) jobsMenuDropdown.style.display = 'none';
    document.removeEventListener('click', _closeJobsMenu);
  });

  document.getElementById('jobsFilterMatchBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _filterMatchingOnly = !_filterMatchingOnly;
    _drawJobs();
  });

  document.getElementById('jobsSelectMatchingBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const matching = allScored.filter(r => r.matched.length > 0);
    if (_selectedIds.size === matching.length && matching.every(r => _selectedIds.has(r.jobId))) {
      _selectedIds.clear();
    } else {
      matching.forEach(r => _selectedIds.add(r.jobId));
    }
    _drawJobs();
  });

  document.getElementById('jobsCopyBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    copySelectedJDs();
  });

  document.getElementById('jobsClearResultsBtn')?.addEventListener('click', async () => {
    await chrome.storage.local.remove([JOBS_RESULTS_KEY, JOBS_STATE_KEY]);
    _jobResults = [];
    _jobState = { running: false, total: 0, done: 0 };
    _visibleJobIds = null;
    _urlMismatch = false;
    _selectedIds.clear();
    _drawJobs();
  });

  // Stack tag remove
  document.querySelectorAll('.jobs-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      _jobStack = _jobStack.filter(t => t !== btn.dataset.tag);
      saveStack();
      _drawJobs();
    });
  });

  // Stack input
  const stackInput = document.getElementById('jobsStackInput');
  const addTag = () => {
    const val = stackInput?.value.trim();
    if (val && !_jobStack.includes(val)) {
      _jobStack.push(val);
      saveStack();
    }
    if (stackInput) stackInput.value = '';
    _drawJobs();
  };
  document.getElementById('jobsStackAddBtn')?.addEventListener('click', addTag);
  stackInput?.addEventListener('keydown', e => { if (e.key === 'Enter') addTag(); });

  // Wire filter input — directly show/hide cards without rebuilding DOM
  document.getElementById('jobsCompanyFilter')?.addEventListener('input', function () {
    _companyFilter = this.value;
    const term = _companyFilter.toLowerCase();
    const clearBtn = document.getElementById('jobsFilterClearBtn');
    if (clearBtn) clearBtn.style.display = term ? '' : 'none';
    document.querySelectorAll('.jobs-result-card').forEach(card => {
      const company = card.querySelector('.jobs-result-company')?.textContent?.toLowerCase() || '';
      card.style.display = (!term || company.includes(term)) ? '' : 'none';
    });
  });
  document.getElementById('jobsFilterClearBtn')?.addEventListener('click', () => {
    _companyFilter = '';
    const inp = document.getElementById('jobsCompanyFilter');
    if (inp) { inp.value = ''; inp.focus(); }
    document.getElementById('jobsFilterClearBtn').style.display = 'none';
    document.querySelectorAll('.jobs-result-card').forEach(c => c.style.display = '');
  });

  // Job card checkboxes
  document.querySelectorAll('.jobs-result-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) _selectedIds.add(id);
      else _selectedIds.delete(id);
      _drawJobs();
    });
  });

  // Card row click — expand/collapse tags + toggle selection + focus LinkedIn
  if (_collapseListener) {
    document.removeEventListener('click', _collapseListener);
    _collapseListener = null;
  }

  document.querySelectorAll('.jobs-result-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      e.stopPropagation();
      const id = card.dataset.id;
      // Toggle expansion; clicking a different card switches expansion
      _expandedCardId = (_expandedCardId === id) ? null : id;
      // Toggle selection
      if (_selectedIds.has(id)) _selectedIds.delete(id);
      else _selectedIds.add(id);
      _drawJobs();
      const tab = await findLinkedInJobsTab();
      if (tab) {
        try {
          chrome.tabs.sendMessage(tab.id, { action: 'focusJobCard', jobId: id }, () => {
            void chrome.runtime.lastError;
          });
        } catch {}
      }
    });
  });

  // Outside click collapses the expanded card
  if (_expandedCardId) {
    _collapseListener = (e) => {
      if (!e.target.closest('.jobs-result-card')) {
        _collapseListener = null;
        _expandedCardId = null;
        _drawJobs();
      }
    };
    setTimeout(() => document.addEventListener('click', _collapseListener), 0);
  }
}

// ── Live updates from storage ─────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!document.getElementById('jobsPanel')?.classList.contains('active')) return;
  let changed = false;
  if (changes[JOBS_RESULTS_KEY]) { _jobResults = changes[JOBS_RESULTS_KEY].newValue || []; changed = true; }
  if (changes[JOBS_STATE_KEY])   { _jobState   = changes[JOBS_STATE_KEY].newValue   || {}; changed = true; }
  if (changed) _drawJobs();
});

// ── Init (called when tab is activated) ──────────────────────────────────────

globalThis.renderJobsPanel = async function () {
  await loadJobsData();
  _selectedIds.clear();
  _visibleJobIds = null;
  _urlMismatch = false;

  const tab = await findLinkedInJobsTab();
  if (tab && _jobResults.length > 0) {
    if (_jobState.pageUrl && normalizeJobUrl(_jobState.pageUrl) !== normalizeJobUrl(tab.url)) {
      _urlMismatch = true;
    } else {
      _visibleJobIds = await new Promise(resolve => {
        try {
          chrome.tabs.sendMessage(tab.id, { action: 'getVisibleJobIds' }, (resp) => {
            void chrome.runtime.lastError;
            resolve(resp?.ids || null);
          });
        } catch { resolve(null); }
      });
    }
  }
  _drawJobs();
};
