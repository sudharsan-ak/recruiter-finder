// ── Jobs Seen Sub-tab ─────────────────────────────────────────────────────────

let _seenSearch      = '';
let _seenSort        = 'newest';
let _seenLimit       = 50;
let _seenHistory     = [];
let _selectedSeenIds = new Set();

function _seenJobId(url) {
  const m = (url || '').match(/\/jobs\/view\/(\d+)|currentJobId=(\d+)/);
  return m ? (m[1] || m[2]) : null;
}

async function renderSeenTab() {
  const { history } = await loadSeenHistory();
  _seenHistory = history;
  _drawSeen();
}

function _filterAndSortSeen() {
  let list = [..._seenHistory];
  if (_seenSearch) {
    const t = _seenSearch.toLowerCase();
    list = list.filter(e =>
      e[1]?.toLowerCase().includes(t) || e[2]?.toLowerCase().includes(t)
    );
  }
  switch (_seenSort) {
    case 'newest':   list.sort((a, b) => b[4] - a[4]); break;
    case 'oldest':   list.sort((a, b) => a[4] - b[4]); break;
    case 'score':    list.sort((a, b) => {
      const sa = (_jobMatchCache[_seenJobId(a[3])] || []).length;
      const sb = (_jobMatchCache[_seenJobId(b[3])] || []).length;
      return sb - sa;
    }); break;
    case 'company':  list.sort((a, b) => (a[2] || '').localeCompare(b[2] || '')); break;
    case 'companyz': list.sort((a, b) => (b[2] || '').localeCompare(a[2] || '')); break;
    case 'title':    list.sort((a, b) => (a[1] || '').localeCompare(b[1] || '')); break;
  }
  return list;
}

function _drawSeen() {
  const sorted  = _filterAndSortSeen();
  const limited = _seenLimit === 0 ? sorted : sorted.slice(0, _seenLimit);
  const total   = _seenHistory.length;
  const selCount = _selectedSeenIds.size;

  jobsMain.innerHTML = `
    <div class="jobs-seen-toolbar">
      <div class="jobs-seen-search-wrap">
        <input type="text" id="seenSearchInput" class="jobs-seen-search"
          placeholder="🔍 Search title or company…"
          autocomplete="off" value="${_seenSearch}" />
        <button id="seenSearchClear" class="jobs-filter-clear-btn"
          style="display:${_seenSearch ? '' : 'none'}">✕</button>
      </div>
      <div class="jobs-seen-controls">
        <select id="seenSortSelect" class="jobs-seen-select">
          <option value="newest"   ${_seenSort==='newest'   ?'selected':''}>Newest</option>
          <option value="oldest"   ${_seenSort==='oldest'   ?'selected':''}>Oldest</option>
          <option value="score"    ${_seenSort==='score'    ?'selected':''}>Best match</option>
          <option value="company"  ${_seenSort==='company'  ?'selected':''}>Company A-Z</option>
          <option value="companyz" ${_seenSort==='companyz' ?'selected':''}>Company Z-A</option>
          <option value="title"    ${_seenSort==='title'    ?'selected':''}>Title A-Z</option>
        </select>
        <select id="seenLimitSelect" class="jobs-seen-select">
          <option value="25"  ${_seenLimit===25  ?'selected':''}>Show 25</option>
          <option value="50"  ${_seenLimit===50  ?'selected':''}>Show 50</option>
          <option value="100" ${_seenLimit===100 ?'selected':''}>Show 100</option>
          <option value="200" ${_seenLimit===200 ?'selected':''}>Show 200</option>
          <option value="0"   ${_seenLimit===0   ?'selected':''}>Show All</option>
        </select>
      </div>
    </div>
    <div class="jobs-seen-stats-row">
      <span class="jobs-seen-stats" id="seenStatsText">
        ${total} total · showing ${limited.length}${selCount ? ` · ${selCount} selected` : ''}
      </span>
      <div style="display:flex;gap:5px;align-items:center">
        <button class="jobs-clear-btn" id="seenClearSelBtn"
          style="display:${selCount ? '' : 'none'}">✕ Clear</button>
        <button class="jobs-scan-btn" id="seenCopyBtn"
          style="display:${selCount ? '' : 'none'};padding:4px 10px;font-size:10px">
          📋 Copy${selCount ? ` (${selCount})` : ''}
        </button>
        <button class="jobs-sort-btn ${_seenSort === 'score' ? 'active' : ''}" id="seenSortBtn"
          title="${_seenSort === 'score' ? 'Sorted by score — click to revert' : 'Sort by score'}">
          ${_seenSort === 'score' ? '↓ Score' : '↕ Sort'}
        </button>
        <div class="jobs-results-menu-wrap">
          <button class="jobs-menu-btn" id="seenClearMenuBtn">🗑 Clear ▾</button>
          <div class="jobs-menu-dropdown" id="seenClearDropdown" style="display:none">
            <button class="jobs-menu-item jobs-menu-item-danger" id="seenClearAll">Clear All</button>
            <div class="jobs-menu-sep"></div>
            <button class="jobs-menu-item jobs-menu-item-danger" id="seenClearLast7">Clear last 7 days</button>
            <button class="jobs-menu-item jobs-menu-item-danger" id="seenClearLast14">Clear last 14 days</button>
            <button class="jobs-menu-item jobs-menu-item-danger" id="seenClearLast30">Clear last 30 days</button>
            <div class="jobs-menu-sep"></div>
            <button class="jobs-menu-item jobs-menu-item-danger" id="seenKeep7">Keep last 7 days</button>
            <button class="jobs-menu-item jobs-menu-item-danger" id="seenKeep30">Keep last 30 days</button>
            <button class="jobs-menu-item jobs-menu-item-danger" id="seenKeep90">Keep last 90 days</button>
          </div>
        </div>
      </div>
    </div>

    ${limited.length > 0 ? `
      <div class="jobs-seen-list">
        ${limited.map(e => _renderSeenEntry(e)).join('')}
      </div>
    ` : `
      <div class="jobs-empty">
        ${total === 0
          ? 'No jobs scanned yet. Run a scan to start building history.'
          : 'No results match your search.'}
      </div>
    `}
  `;

  _wireSeenEvents();
}

function _renderSeenEntry([hash, title, company, url, ts]) {
  const jobId    = _seenJobId(url);
  const matched  = jobId ? (_jobMatchCache[jobId] || []) : [];
  const stackLen = _jobStack.length;
  const score    = matched.length;
  const sel      = _selectedSeenIds.has(hash);

  const scoreLabel = stackLen > 0
    ? `<span class="jobs-score ${score === 0 ? 'jobs-score-none' : score === stackLen ? 'jobs-score-full' : 'jobs-score-partial'}">${score}/${stackLen} match</span>`
    : '';

  const tagsHtml = stackLen > 0 ? `
    <div class="jobs-seen-tags-expand" style="display:none">
      ${matched.map(t => `<span class="jobs-match-tag">${t}</span>`).join('')}
      ${_jobStack.filter(t => !matched.includes(t)).map(t => `<span class="jobs-miss-tag">${t}</span>`).join('')}
    </div>` : '';

  return `
    <div class="jobs-seen-card ${sel ? 'selected' : ''}" data-hash="${hash}">
      <input type="checkbox" class="jobs-result-check seen-check" data-hash="${hash}" ${sel ? 'checked' : ''} />
      <div class="jobs-seen-body">
        <div class="jobs-seen-title">
          <a href="${url}" target="_blank">${title || '(no title)'}</a>
          <span class="jobs-result-company">${company || ''}</span>
        </div>
        <div class="jobs-result-meta">${scoreLabel}${tagsHtml}</div>
        <div class="jobs-seen-date">${formatSeenDate(ts)}</div>
      </div>
      <button class="jobs-seen-delete" data-hash="${hash}" title="Remove">🗑</button>
    </div>`;
}

// ── Update stats row without full redraw ──────────────────────────────────────

function _updateSeenStats() {
  const sel = _selectedSeenIds.size;
  const visible = document.querySelectorAll('.jobs-seen-card:not([style*="display: none"])').length;
  const total = _seenHistory.length;
  const statsEl = document.getElementById('seenStatsText');
  const copyBtn = document.getElementById('seenCopyBtn');
  const clearSelBtn = document.getElementById('seenClearSelBtn');
  if (statsEl) statsEl.textContent = `${total} total · showing ${visible}${sel ? ` · ${sel} selected` : ''}`;
  if (copyBtn) { copyBtn.style.display = sel ? '' : 'none'; copyBtn.textContent = `📋 Copy (${sel})`; }
  if (clearSelBtn) clearSelBtn.style.display = sel ? '' : 'none';
}

// ── Copy selected seen entries ────────────────────────────────────────────────

function _copySelectedSeen() {
  const selected = _seenHistory.filter(e => _selectedSeenIds.has(e[0]));
  if (!selected.length) return;

  const entries = selected.map(([, title, company, url]) => {
    const jobId = _seenJobId(url);
    return {
      company: company || 'Unknown Company',
      role:    title   || 'Unknown Role',
      jd:      (jobId && _jobJDCache[jobId]) || '[JD text not available — re-scan to retrieve]',
      url:     url     || '',
    };
  });

  const text = entries
    .map(e => `Company - ${e.company}\nRole - ${e.role}\nJD:\n\n${e.jd}`)
    .join('\n\n' + '─'.repeat(60) + '\n\n');

  navigator.clipboard.writeText(text).catch(() => {});

  entries.forEach(e => writeJdToLocalHelper({
    company:    e.company,
    role:       e.role,
    text:       e.jd,
    sourceUrl:  e.url,
    capturedAt: new Date().toISOString(),
  }));
}

function _wireSeenEvents() {
  // Search — direct DOM show/hide to preserve focus
  document.getElementById('seenSearchInput')?.addEventListener('input', function () {
    _seenSearch = this.value;
    const term = _seenSearch.toLowerCase();
    const clearBtn = document.getElementById('seenSearchClear');
    if (clearBtn) clearBtn.style.display = term ? '' : 'none';
    document.querySelectorAll('.jobs-seen-card').forEach(card => {
      const t = card.querySelector('.jobs-seen-title a')?.textContent?.toLowerCase() || '';
      const c = card.querySelector('.jobs-result-company')?.textContent?.toLowerCase() || '';
      card.style.display = (!term || t.includes(term) || c.includes(term)) ? '' : 'none';
    });
    _updateSeenStats();
  });
  document.getElementById('seenSearchClear')?.addEventListener('click', () => {
    _seenSearch = '';
    const inp = document.getElementById('seenSearchInput');
    if (inp) { inp.value = ''; inp.focus(); }
    document.getElementById('seenSearchClear').style.display = 'none';
    document.querySelectorAll('.jobs-seen-card').forEach(c => c.style.display = '');
    _updateSeenStats();
  });

  // Sort + limit
  document.getElementById('seenSortSelect')?.addEventListener('change', (e) => { _seenSort = e.target.value; _drawSeen(); });
  document.getElementById('seenLimitSelect')?.addEventListener('change', (e) => { _seenLimit = parseInt(e.target.value); _drawSeen(); });
  document.getElementById('seenSortBtn')?.addEventListener('click', () => {
    _seenSort = _seenSort === 'score' ? 'newest' : 'score';
    _drawSeen();
  });

  // Card click → expand/collapse tags (no redraw)
  document.querySelectorAll('.jobs-seen-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'A' || e.target.tagName === 'BUTTON') return;
      const tagsDiv = card.querySelector('.jobs-seen-tags-expand');
      if (!tagsDiv) return;
      const open = tagsDiv.style.display !== 'none';
      tagsDiv.style.display = open ? 'none' : '';
      card.classList.toggle('expanded', !open);
    });
  });

  // Checkboxes (no redraw)
  document.querySelectorAll('.seen-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      const hash = cb.dataset.hash;
      const card = cb.closest('.jobs-seen-card');
      if (cb.checked) { _selectedSeenIds.add(hash); card?.classList.add('selected'); }
      else            { _selectedSeenIds.delete(hash); card?.classList.remove('selected'); }
      _updateSeenStats();
    });
  });

  // Clear selection
  document.getElementById('seenClearSelBtn')?.addEventListener('click', () => {
    _selectedSeenIds.clear();
    document.querySelectorAll('.seen-check').forEach(cb => { cb.checked = false; });
    document.querySelectorAll('.jobs-seen-card').forEach(c => c.classList.remove('selected'));
    _updateSeenStats();
  });

  // Copy selected
  document.getElementById('seenCopyBtn')?.addEventListener('click', _copySelectedSeen);

  // Clear dropdown
  const clearMenuBtn  = document.getElementById('seenClearMenuBtn');
  const clearDropdown = document.getElementById('seenClearDropdown');
  clearMenuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = clearDropdown.style.display !== 'none';
    if (open) { clearDropdown.style.display = 'none'; return; }
    const rect = clearMenuBtn.getBoundingClientRect();
    clearDropdown.style.position = 'fixed';
    clearDropdown.style.bottom = 'auto';
    clearDropdown.style.right  = (window.innerWidth - rect.right) + 'px';
    clearDropdown.style.top    = (rect.bottom + 4) + 'px';
    clearDropdown.style.display = 'block';
  });
  document.addEventListener('click', function _closeClear() {
    if (clearDropdown) clearDropdown.style.display = 'none';
    document.removeEventListener('click', _closeClear);
  });

  // Clear All
  document.getElementById('seenClearAll')?.addEventListener('click', (e) => {
    e.stopPropagation(); clearDropdown.style.display = 'none';
    const count = _seenHistory.length;
    jobsConfirm('Clear All Seen Jobs',
      `This will permanently delete all ${count} seen job${count !== 1 ? 's' : ''} from your history. This cannot be undone.`,
      async () => { await saveSeenHistory([], []); _seenHistory = []; _selectedSeenIds.clear(); _drawSeen(); }
    );
  });

  // Clear last N days
  ['7','14','30'].forEach(days => {
    document.getElementById(`seenClearLast${days}`)?.addEventListener('click', (e) => {
      e.stopPropagation(); clearDropdown.style.display = 'none';
      const cutoff = Date.now() - parseInt(days) * 86400000;
      const count = _seenHistory.filter(e => e[4] >= cutoff).length;
      if (!count) return;
      jobsConfirm(`Clear Last ${days} Days`,
        `This will delete ${count} job${count !== 1 ? 's' : ''} scanned in the last ${days} days. This cannot be undone.`,
        async () => { await clearSeenByPredicate(e => e[4] >= cutoff); const { history } = await loadSeenHistory(); _seenHistory = history; _selectedSeenIds.clear(); _drawSeen(); }
      );
    });
  });

  // Keep last N days
  ['7','30','90'].forEach(days => {
    document.getElementById(`seenKeep${days}`)?.addEventListener('click', (e) => {
      e.stopPropagation(); clearDropdown.style.display = 'none';
      const cutoff = Date.now() - parseInt(days) * 86400000;
      const count = _seenHistory.filter(e => e[4] < cutoff).length;
      if (!count) return;
      jobsConfirm(`Keep Last ${days} Days`,
        `This will delete ${count} older job${count !== 1 ? 's' : ''} (keeping the last ${days} days). This cannot be undone.`,
        async () => { await clearSeenByPredicate(e => e[4] < cutoff); const { history } = await loadSeenHistory(); _seenHistory = history; _selectedSeenIds.clear(); _drawSeen(); }
      );
    });
  });

  // Individual delete
  document.querySelectorAll('.jobs-seen-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const hash = btn.dataset.hash;
      const entry = _seenHistory.find(e => e[0] === hash);
      jobsConfirm('Remove Seen Job', `Remove "${entry?.[1] || 'this entry'}" from your history?`,
        async () => {
          await clearSeenByPredicate(e => e[0] === hash);
          const { history } = await loadSeenHistory();
          _seenHistory = history;
          _selectedSeenIds.delete(hash);
          _drawSeen();
        }
      );
    });
  });
}

// ── Confirmation helper (reuses #confirmModal) ────────────────────────────────

function jobsConfirm(title, message, onConfirm) {
  const modal      = document.getElementById('confirmModal');
  const titleEl    = document.getElementById('confirmModalTitle');
  const msgEl      = document.getElementById('confirmModalMessage');
  const confirmBtn = document.getElementById('confirmModalConfirmBtn');
  const cancelBtn  = document.getElementById('confirmModalCancelBtn');
  if (!modal) { if (confirm(message)) onConfirm(); return; }

  titleEl.textContent = title;
  msgEl.textContent   = message;
  modal.style.display = 'flex';

  const cleanup = () => { modal.style.display = 'none'; };
  const onOk    = () => { cleanup(); onConfirm(); };

  const newConfirm = confirmBtn.cloneNode(true);
  const newCancel  = cancelBtn.cloneNode(true);
  confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

  newConfirm.addEventListener('click', onOk);
  newCancel.addEventListener('click', cleanup);
  modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); }, { once: true });
}
