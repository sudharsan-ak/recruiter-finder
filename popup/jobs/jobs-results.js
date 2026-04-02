// ── Jobs Results Sub-tab ──────────────────────────────────────────────────────

function _drawResults({ error } = {}) {
  // Results are only meaningful on a LinkedIn jobs search page
  if (!_onLinkedInJobsPage && !_jobState.running) {
    jobsMain.innerHTML = `<div class="jobs-empty">Navigate to a LinkedIn jobs search page, then click Scan.</div>`;
    return;
  }

  const running = _jobState.running;
  const { total, done } = _jobState;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const allScored = _jobResults.map(r => ({
    ...r,
    matched: r.isFromHistory
      ? (_jobMatchCache[r.jobId] || [])
      : matchStack(r.jdText, _jobStack),
  }));
  if (_resultsSortOrder === 'score') {
    allScored.sort((a, b) => b.matched.length - a.matched.length);
  }

  // Persist match scores + JD texts for newly scanned jobs
  const newMatchEntries = {};
  const newJDEntries    = {};
  allScored.forEach(r => {
    if (!r.isFromHistory && r.jdText) {
      newMatchEntries[r.jobId] = r.matched;
      newJDEntries[r.jobId]    = r.jdText;
    }
  });
  if (Object.keys(newMatchEntries).length) {
    const merged = { ..._jobMatchCache, ...newMatchEntries };
    _jobMatchCache = merged;
    chrome.storage.local.set({ [JOBS_MATCH_CACHE]: merged }).catch(() => {});
  }
  if (Object.keys(newJDEntries).length) saveJDCache(newJDEntries);

  const visibleScored = _visibleJobIds
    ? allScored.filter(r => _visibleJobIds.includes(r.jobId))
    : allScored;

  const matchingCount = visibleScored.filter(r => r.matched.length > 0).length;
  const scored = _filterMatchingOnly
    ? visibleScored.filter(r => r.matched.length > 0)
    : visibleScored;
  const selCount = _selectedIds.size;
  const hiddenCount = allScored.length - visibleScored.length;

  jobsMain.innerHTML = `
    <div class="jobs-scan-section">
      ${running ? `
        <button class="jobs-stop-btn" id="jobsStopBtn">⏹ Stop</button>
        <div class="jobs-progress-row">
          <div class="jobs-progress-bar">
            <div class="jobs-progress-fill" style="width:${pct}%"></div>
          </div>
          <span class="jobs-progress-label">Scanning ${done} / ${total}</span>
        </div>
      ` : `
        <div class="jobs-scan-row">
          <button class="jobs-scan-btn" id="jobsScanBtn">▶ Scan Jobs</button>
          <span class="jobs-max-label">up to</span>
          <input type="number" id="jobsMaxInput" class="jobs-max-input"
            value="${_maxJobs}" min="1" max="500" />
          <span class="jobs-max-label">jobs</span>
        </div>
      `}
      ${_urlMismatch ? `
        <div class="jobs-warn">⚠ Search page has changed. Results below are from a previous scan.</div>
      ` : ''}
      ${error ? `<div class="jobs-error">${error}</div>` : ''}
    </div>

    ${allScored.length > 0 ? `
      ${hiddenCount > 0 && !_urlMismatch ? `
        <div class="jobs-page-note">
          Showing ${visibleScored.length} of ${allScored.length} scanned jobs visible on current page.
        </div>
      ` : ''}
      <div class="jobs-results-header">
        <span class="jobs-results-summary">
          ${scored.length} shown · ${matchingCount} match${selCount ? ` · ${selCount} selected` : ''}
        </span>
        <div class="jobs-results-header-right">
          <button class="jobs-sort-btn ${_resultsSortOrder === 'score' ? 'active' : ''}" id="jobsSortBtn"
            title="${_resultsSortOrder === 'score' ? 'Sorted by score — click for scan order' : 'Sort by score'}">
            ${_resultsSortOrder === 'score' ? '↓ Score' : '↕ Sort'}
          </button>
          ${selCount > 0 ? `<button class="jobs-clear-btn" id="jobsClearSelBtn">✕ Clear</button>` : ''}
        </div>
      </div>
      <div class="jobs-filter-bar-inner">
        <input type="text" id="jobsCompanyFilter" class="jobs-company-filter"
          placeholder="🔍 Filter by company…" autocomplete="off"
          value="${_companyFilter}" />
        <button id="jobsFilterClearBtn" class="jobs-filter-clear-btn"
          style="display:${_companyFilter ? '' : 'none'}">✕</button>
      </div>
      <div class="jobs-results-list">
        ${scored.map(r => _renderResultCard(r)).join('')}
      </div>
    ` : (allScored.length === 0 && !running ? `
      <div class="jobs-empty">
        Navigate to a LinkedIn jobs search page, then click Scan.
      </div>
    ` : '')}
  `;

  _wireResultsEvents();
}

function _renderResultCard(r) {
  const sel = _selectedIds.has(r.jobId);
  const expanded = r.jobId === _expandedCardId;
  const score = r.matched.length;
  const stackLen = _jobStack.length;
  const scoreLabel = stackLen > 0
    ? `<span class="jobs-score ${score === 0 ? 'jobs-score-none' : score === stackLen ? 'jobs-score-full' : 'jobs-score-partial'}">${score}/${stackLen} match</span>`
    : '';

  let repostBadge = '';
  if (r.isFromHistory) {
    const d = formatSeenDate(r.firstSeenAt);
    const scoreNote = score > 0 ? ` · score from last scan` : '';
    repostBadge = `<div class="jobs-history-badge">✓ Already scanned · First seen ${d}${scoreNote}</div>`;
  } else if (r.isDuplicate) {
    if (r.previouslySeen) {
      const d = formatSeenDate(r.previouslySeen.firstSeenAt);
      const orig = r.previouslySeen.company !== r.company
        ? ` · ${r.previouslySeen.company}` : '';
      repostBadge = `
        <div class="jobs-repost-badge">
          🔁 Repost · First seen ${d}${orig}
          <a href="${r.previouslySeen.url}" target="_blank" class="jobs-repost-link">↗</a>
        </div>`;
    } else {
      repostBadge = `<div class="jobs-repost-badge jobs-repost-badge--no-detail">🔁 Repost detected</div>`;
    }
  }

  return `
    <div class="jobs-result-card ${sel ? 'selected' : ''} ${expanded ? 'expanded' : ''}"
      data-id="${r.jobId}">
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
        ${repostBadge}
      </div>
    </div>`;
}

function _wireResultsEvents() {
  document.getElementById('jobsScanBtn')?.addEventListener('click', () => {
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

  document.getElementById('jobsSortBtn')?.addEventListener('click', () => {
    _resultsSortOrder = _resultsSortOrder === 'score' ? 'scan' : 'score';
    _drawResults();
  });

  document.getElementById('jobsClearSelBtn')?.addEventListener('click', () => {
    _selectedIds.clear();
    _drawResults();
  });

  // Company filter — direct DOM show/hide, no redraw
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

  // Checkboxes
  document.querySelectorAll('.jobs-result-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) _selectedIds.add(id);
      else _selectedIds.delete(id);
      _drawResults();
      _drawJobsChrome();
    });
  });

  // Card click — expand + select + focus LinkedIn
  if (_collapseListener) {
    document.removeEventListener('click', _collapseListener);
    _collapseListener = null;
  }
  document.querySelectorAll('.jobs-result-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      e.stopPropagation();
      const id = card.dataset.id;
      _expandedCardId = (_expandedCardId === id) ? null : id;
      if (_selectedIds.has(id)) _selectedIds.delete(id);
      else _selectedIds.add(id);
      _drawResults();
      _drawJobsChrome();
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

  if (_expandedCardId) {
    _collapseListener = (e) => {
      if (!e.target.closest('.jobs-result-card')) {
        _collapseListener = null;
        _expandedCardId = null;
        _drawResults();
      }
    };
    setTimeout(() => document.addEventListener('click', _collapseListener), 0);
  }
}

// ── Scan actions ──────────────────────────────────────────────────────────────

async function startScan() {
  const tab = await findLinkedInJobsTab();
  if (!tab) {
    _drawResults({ error: 'No LinkedIn jobs page found. Navigate to linkedin.com/jobs first.' });
    return;
  }
  await chrome.storage.local.set({
    jobScanResults: [],
    jobScanState: { running: true, total: 0, done: 0, pageUrl: tab.url },
  });
  _jobResults = [];
  _jobState   = { running: true, total: 0, done: 0 };
  _selectedIds.clear();
  _drawResults();
  try {
    chrome.tabs.sendMessage(tab.id, { action: 'startJobScan', maxJobs: _maxJobs }, () => {
      void chrome.runtime.lastError;
    });
  } catch {}
}

async function stopScan() {
  // Force-reset storage state immediately so the UI updates regardless of content script response
  await chrome.storage.local.set({
    [JOBS_STATE_KEY]: { running: false, total: 0, done: 0 },
  });
  _jobState = { running: false, total: 0, done: 0 };
  _drawResults();
  _drawJobsChrome();
  const tab = await findLinkedInJobsTab();
  if (tab) {
    try {
      chrome.tabs.sendMessage(tab.id, { action: 'stopJobScan' }, () => {
        void chrome.runtime.lastError;
      });
    } catch {}
  }
}

function copySelectedJDs() {
  const selected = _jobResults.filter(r => _selectedIds.has(r.jobId));
  if (!selected.length) return;

  const entries = selected.map(r => ({
    company: r.company || 'Unknown Company',
    role:    r.title   || 'Unknown Role',
    jd:      r.jdText  || _jobJDCache[r.jobId] || '[JD text not available — re-scan to retrieve]',
    url:     r.url     || '',
  }));

  const text = entries
    .map(e => `Company - ${e.company}\nRole - ${e.role}\nJD:\n\n${e.jd}`)
    .join('\n\n' + '─'.repeat(60) + '\n\n');

  navigator.clipboard.writeText(text).catch(() => {});

  entries.forEach(e => writeJdToLocalHelper({
    company:     e.company,
    role:        e.role,
    jd:          e.jd,
    text:        `Company - ${e.company}\nRole - ${e.role}\nJD:\n\n${e.jd}`,
    sourceUrl:   e.url,
    capturedAt:  new Date().toISOString(),
  }));
}
