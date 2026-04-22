// ── Jobs Panel Coordinator ────────────────────────────────────────────────────
// Owns sub-tab switching, the Options menu (including My Stack modal trigger),
// and the top chrome that's always visible regardless of which sub-tab is active.

// ── Sub-tab chrome ────────────────────────────────────────────────────────────

function _drawJobsChrome() {
  const panel = document.getElementById('jobsPanel');
  let chromeEl = document.getElementById('jobsChrome');
  if (!chromeEl) {
    chromeEl = document.createElement('div');
    chromeEl.id = 'jobsChrome';
    panel.insertBefore(chromeEl, document.getElementById('jobsMain'));
  }

  chromeEl.innerHTML = `
    <div class="jobs-tab-row">
      <div class="jobs-subtabs">
        <button class="jobs-subtab ${_activeJobsSubTab === 'results' ? 'active' : ''}"
          id="jobsSubResults">Results</button>
        <button class="jobs-subtab ${_activeJobsSubTab === 'seen' ? 'active' : ''}"
          id="jobsSubSeen">Seen Jobs</button>
      </div>
      <div class="jobs-chrome-right">
        <button class="jobs-refresh-btn" id="jobsRefreshBtn" title="Refresh panel">↺</button>
        <div class="jobs-results-menu-wrap">
        <button class="jobs-menu-btn" id="jobsOptionsBtn">≡ Options</button>
        <div class="jobs-menu-dropdown" id="jobsOptionsDropdown" style="display:none">
          <button class="jobs-menu-item" id="jobsMyStackBtn">🗂 My Stack</button>
          <div class="jobs-menu-sep"></div>
          <button class="jobs-menu-item ${_filterMatchingOnly ? 'jobs-menu-item-active' : ''}"
            id="jobsFilterMatchBtn">
            ${_filterMatchingOnly ? '✓ Matching only' : '○ Matching only'}
          </button>
          <button class="jobs-menu-item" id="jobsSelectMatchingBtn">Select Matching</button>
          <button class="jobs-menu-item" id="jobsCopyBtn"
            ${_selectedIds.size === 0 ? 'disabled' : ''}>
            📋 Copy JDs${_selectedIds.size ? ` (${_selectedIds.size})` : ''}
          </button>
          <div class="jobs-menu-sep"></div>
          <button class="jobs-menu-item jobs-menu-item-danger" id="jobsClearResultsBtn">
            🗑 Clear Results
          </button>
        </div>
        </div>
      </div>
    </div>
  `;

  // Sub-tab switching
  document.getElementById('jobsSubResults')?.addEventListener('click', () => {
    _activeJobsSubTab = 'results';
    _drawJobsChrome();
    _drawResults();
  });
  document.getElementById('jobsSubSeen')?.addEventListener('click', () => {
    _activeJobsSubTab = 'seen';
    _drawJobsChrome();
    renderSeenTab();
  });

  // Refresh button
  document.getElementById('jobsRefreshBtn')?.addEventListener('click', () => {
    renderJobsPanel();
  });

  // Options dropdown
  const optBtn = document.getElementById('jobsOptionsBtn');
  const optDd  = document.getElementById('jobsOptionsDropdown');
  optBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    optDd.style.display = optDd.style.display !== 'none' ? 'none' : 'block';
  });
  document.addEventListener('click', function _closeOpts() {
    if (optDd) optDd.style.display = 'none';
    document.removeEventListener('click', _closeOpts);
  });

  // My Stack modal
  document.getElementById('jobsMyStackBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    optDd.style.display = 'none';
    _openStackModal();
  });


  // Matching only toggle
  document.getElementById('jobsFilterMatchBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    _filterMatchingOnly = !_filterMatchingOnly;
    optDd.style.display = 'none';
    _drawJobsChrome();
    if (_activeJobsSubTab === 'results') _drawResults();
  });

  // Select Matching
  document.getElementById('jobsSelectMatchingBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    optDd.style.display = 'none';
    const allScored = _jobResults.map(r => ({
      ...r, matched: matchStack(r.jdText, _jobStack),
    }));
    const matching = allScored.filter(r => r.matched.length > 0);
    if (_selectedIds.size === matching.length && matching.every(r => _selectedIds.has(r.jobId))) {
      _selectedIds.clear();
    } else {
      matching.forEach(r => _selectedIds.add(r.jobId));
    }
    if (_activeJobsSubTab === 'results') _drawResults();
    _drawJobsChrome();
  });

  // Copy JDs
  document.getElementById('jobsCopyBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    optDd.style.display = 'none';
    copySelectedJDs();
  });

  // Clear Results
  document.getElementById('jobsClearResultsBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    optDd.style.display = 'none';
    jobsConfirm(
      'Clear Scan Results',
      'This will remove all current scan results. This cannot be undone.',
      async () => {
        await chrome.storage.local.remove([JOBS_RESULTS_KEY, JOBS_STATE_KEY]);
        _jobResults = [];
        _jobState   = { running: false, total: 0, done: 0 };
        _visibleJobIds = null;
        _urlMismatch   = false;
        _selectedIds.clear();
        _drawJobsChrome();
        _drawResults();
      }
    );
  });
}

// ── My Stack Modal ────────────────────────────────────────────────────────────

function _openStackModal() {
  const modal = document.getElementById('jobsStackModal');
  if (!modal) return;
  _renderStackModal();
  modal.style.display = 'flex';
}

function _renderStackModal() {
  const list = document.getElementById('jobsStackModalTags');
  const input = document.getElementById('jobsStackModalInput');
  if (!list) return;

  list.innerHTML = _jobStack.map(t => `
    <span class="jobs-stack-tag">
      ${t}<button class="jobs-tag-remove jobs-stack-modal-remove" data-tag="${t}">×</button>
    </span>`).join('');

  document.querySelectorAll('.jobs-stack-modal-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      _jobStack = _jobStack.filter(t => t !== btn.dataset.tag);
      saveStack();
      _renderStackModal();
    });
  });

  if (input) {
    input.onkeydown = (e) => { if (e.key === 'Enter') _addStackTag(); };
  }
}

function _addStackTag() {
  const input = document.getElementById('jobsStackModalInput');
  const val = input?.value.trim();
  if (val && !_jobStack.includes(val)) {
    _jobStack.push(val);
    saveStack();
  }
  if (input) input.value = '';
  _renderStackModal();
}

// ── Settings Modal ────────────────────────────────────────────────────────────

globalThis._openSettingsModal = async function _openSettingsModal() {
  const modal = document.getElementById('myProfileModal');
  if (!modal) return;
  const d = await new Promise(r => chrome.storage.local.get(['myProfileText', 'myGroqKey', 'myGroqModel'], r));
  document.getElementById('myProfileTextarea').value  = d.myProfileText || '';
  document.getElementById('myGroqKeyInput').value     = d.myGroqKey     || '';
  document.getElementById('myGroqModelSelect').value  = d.myGroqModel   || 'llama-3.3-70b-versatile';
  modal.classList.add('open');
}

// ── Modal close + add button (wired once at load time) ───────────────────────

document.getElementById('jobsStackModalCloseBtn')?.addEventListener('click', () => {
  document.getElementById('jobsStackModal').style.display = 'none';
  _drawJobsChrome(); // refresh Options count
});
document.getElementById('jobsStackModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('jobsStackModal'))
    document.getElementById('jobsStackModal').style.display = 'none';
});
document.getElementById('jobsStackModalAddBtn')?.addEventListener('click', _addStackTag);

// Settings modal
document.getElementById('myProfileSaveBtn')?.addEventListener('click', async () => {
  const text      = document.getElementById('myProfileTextarea').value;
  const groqKey   = document.getElementById('myGroqKeyInput').value.trim();
  const groqModel = document.getElementById('myGroqModelSelect').value;
  await chrome.storage.local.set({ myProfileText: text, myGroqKey: groqKey, myGroqModel: groqModel });
  document.getElementById('myProfileModal').classList.remove('open');
});
document.getElementById('myProfileCancelBtn')?.addEventListener('click', () => {
  document.getElementById('myProfileModal').classList.remove('open');
});
document.getElementById('myProfileModal')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('myProfileModal'))
    document.getElementById('myProfileModal').classList.remove('open');
});

// ── Live updates from storage ─────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!document.getElementById('jobsPanel')?.classList.contains('active')) return;
  let changed = false;
  if (changes[JOBS_RESULTS_KEY]) { _jobResults = changes[JOBS_RESULTS_KEY].newValue || []; changed = true; }
  if (changes[JOBS_STATE_KEY])   { _jobState   = changes[JOBS_STATE_KEY].newValue   || {}; changed = true; }
  if (changed && _activeJobsSubTab === 'results') _drawResults();
  if (changed) _drawJobsChrome();
});

// ── Init ──────────────────────────────────────────────────────────────────────

globalThis.renderJobsPanel = async function () {
  await loadJobsData();
  _selectedIds.clear();
  _visibleJobIds = null;
  _urlMismatch   = false;

  // Results tab is only relevant when the active tab is a LinkedIn jobs search page
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  _onLinkedInJobsPage = !!activeTab?.url?.includes('linkedin.com/jobs');

  if (_onLinkedInJobsPage && _jobResults.length > 0) {
    if (_jobState.pageUrl && normalizeJobUrl(_jobState.pageUrl) !== normalizeJobUrl(activeTab.url)) {
      _urlMismatch = true;
    } else {
      _visibleJobIds = await new Promise(resolve => {
        try {
          chrome.tabs.sendMessage(activeTab.id, { action: 'getVisibleJobIds' }, (resp) => {
            void chrome.runtime.lastError;
            resolve(resp?.ids || null);
          });
        } catch { resolve(null); }
      });
    }
  }

  _drawJobsChrome();
  if (_activeJobsSubTab === 'results') _drawResults();
  else renderSeenTab();
};
