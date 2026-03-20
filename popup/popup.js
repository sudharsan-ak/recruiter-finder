const scanBtn      = document.getElementById('scanBtn');
const copyBtn      = document.getElementById('copyBtn');
const resultsDiv          = document.getElementById('results');
const resultsCompanyBanner = document.getElementById('resultsCompanyBanner');
const statusBox    = document.getElementById('statusBox');
const errorDiv     = document.getElementById('error');
const companyEl    = document.getElementById('companyName');
const progressBar  = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

const tabSearchBtn  = document.getElementById('tabSearch');
const tabBulkBtn    = document.getElementById('tabBulk');
const tabHistoryBtn = document.getElementById('tabHistory');
const searchPanel   = document.getElementById('searchPanel');
const bulkPanel     = document.getElementById('bulkPanel');
const historyPanel  = document.getElementById('historyPanel');
const historyList   = document.getElementById('historyList');
const historySearch = document.getElementById('historySearch');
const clearSearchBtn   = document.getElementById('clearSearchBtn');
const clearHistBtn     = document.getElementById('clearHistoryBtn');
const exportCsvBtn     = document.getElementById('exportCsvBtn');
const exportBackupBtn  = document.getElementById('exportBackupBtn');
const importBackupBtn  = document.getElementById('importBackupBtn');
const importFileInput  = document.getElementById('importFileInput');
const addRecruiterBtn  = document.getElementById('addRecruiterBtn');
const refreshLogosBtn  = document.getElementById('refreshLogosBtn');
const historyOptionsBtn = document.getElementById('historyOptionsBtn');
const historyOptionsMenu = document.getElementById('historyOptionsMenu');
const historyActionStatus = document.getElementById('historyActionStatus');

const observerNotif    = document.getElementById('observerNotification');
const obsText          = document.getElementById('obsText');
const obsShowBtn       = document.getElementById('obsShowBtn');
const obsDismissBtn    = document.getElementById('obsDismissBtn');

const profileNotif        = document.getElementById('profileNotif');
const profileNotifText    = document.getElementById('profileNotifText');
const profileNotifAddBtn  = document.getElementById('profileNotifAddBtn');
const profileNotifDismiss = document.getElementById('profileNotifDismiss');
const observerModal    = document.getElementById('observerModal');
const obsModalTitle    = document.getElementById('obsModalTitle');
const obsModalList     = document.getElementById('obsModalList');
const obsModalSelCount = document.getElementById('obsModalSelCount');
const obsModalAddBtn   = document.getElementById('obsModalAddBtn');
const obsModalCloseBtn = document.getElementById('obsModalCloseBtn');
const obsSelectAll     = document.getElementById('obsSelectAll');
const obsDeselectAll   = document.getElementById('obsDeselectAll');

const bulkTextarea    = document.getElementById('bulkTextarea');
const bulkForceRescan = document.getElementById('bulkForceRescan');
const bulkSearchBtn   = document.getElementById('bulkSearchBtn');
const bulkProgressBar = document.getElementById('bulkProgressBar');
const bulkProgressFill = document.getElementById('bulkProgressFill');
const bulkStatus      = document.getElementById('bulkStatus');
const bulkResultsDiv  = document.getElementById('bulkResults');

const companyMetaEl  = document.getElementById('companyMeta');
const techStackEl    = document.getElementById('techStack');

const autoScanToggle = document.getElementById('autoScanToggle');
const asStatus       = document.getElementById('asStatus');

let _historyActionStatusTimer = null;

function setHistoryActionStatus(text = '', timeoutMs = 2500) {
  if (!historyActionStatus) return;
  clearTimeout(_historyActionStatusTimer);
  historyActionStatus.textContent = text;
  if (text && timeoutMs > 0) {
    _historyActionStatusTimer = setTimeout(() => {
      if (historyActionStatus.textContent === text) historyActionStatus.textContent = '';
    }, timeoutMs);
  }
}

globalThis.setHistoryActionStatus = setHistoryActionStatus;

historyOptionsBtn?.addEventListener('click', e => {
  e.stopPropagation();
  historyOptionsMenu?.classList.toggle('open');
});

document.addEventListener('click', e => {
  if (!historyOptionsMenu?.classList.contains('open')) return;
  if (historyOptionsMenu.contains(e.target) || historyOptionsBtn?.contains(e.target)) return;
  historyOptionsMenu.classList.remove('open');
});

['addRecruiterBtn', 'refreshLogosBtn', 'updateSlugsBtn', 'exportCsvBtn', 'exportBackupBtn', 'importBackupBtn', 'clearHistoryBtn']
  .forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      setTimeout(() => historyOptionsMenu?.classList.remove('open'), 0);
    });
  });

// -Auto-scan toggle ──────────────────────────────────────────────────────────
chrome.storage.local.get(['autoScanEnabled'], ({ autoScanEnabled }) => {
  const on = autoScanEnabled === true; // default OFF
  autoScanToggle.checked = on;
  asStatus.textContent   = on ? 'ON' : 'OFF';
  asStatus.classList.toggle('off', !on);
});

autoScanToggle.addEventListener('change', () => {
  const on = autoScanToggle.checked;
  chrome.storage.local.set({ autoScanEnabled: on });
  asStatus.textContent = on ? 'ON' : 'OFF';
  asStatus.classList.toggle('off', !on);
});

// -Queue state ───────────────────────────────────────────────────────────────
const scanQueue      = [];   // [{ slug }]
let   isScanning     = false;
let   currentScanSlug = null;
let   currentSlug    = null;
let   _onJobPage     = false;  // true only when tab URL contains a job ID

function saveQueue() {
  chrome.storage.session.set({ manualScanQueue: scanQueue.map(q => q.slug) }).catch(() => {});
}

// -Tab switching ─────────────────────────────────────────────────────────────
function activateTab(activeBtn, activePanel, extraInit) {
  [tabSearchBtn, tabBulkBtn, tabHistoryBtn].forEach(b => b.classList.remove('active'));
  [searchPanel, bulkPanel, historyPanel].forEach(p => p.classList.remove('active'));
  activeBtn.classList.add('active');
  activePanel.classList.add('active');
  if (extraInit) extraInit();
}

tabSearchBtn.addEventListener('click', () => {
  // Clear history search when leaving history tab
  historySearch.value = '';
  clearSearchBtn.style.display = 'none';
  activateTab(tabSearchBtn, searchPanel);
});

tabBulkBtn.addEventListener('click', () => {
  historySearch.value = '';
  clearSearchBtn.style.display = 'none';
  activateTab(tabBulkBtn, bulkPanel);
});

tabHistoryBtn.addEventListener('click', () => activateTab(tabHistoryBtn, historyPanel, () => {
  renderHistory();
  backfillLogos();
}));

// -Classify for display grouping ─────────────────────────────────────────────
function classify(title) {
  const t = (title || '').toLowerCase();
  if (/technical|tech\b|sourcing|sourcer/.test(t)) return 'tech';
  if (/head\b|director|vp\b|vice president|lead\b|senior/.test(t)) return 'senior';
  if (/coord/i.test(t)) return 'coord';
  if (/\btalent\b|\bacquisition\b/.test(t)) return 'talent';
  return 'general';
}

// -Search highlight helper ────────────────────────────────────────────────────
function hl(text, term) {
  if (!term || !text) return text || '';
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${safe})`, 'gi'), '<mark class="hl">$1</mark>');
}

// -Render search results ─────────────────────────────────────────────────────
async function renderResults(data, passedLogoUrl = null) {
  // -Company banner ────────────────────────────────────────────────────────
  if (currentSlug) {
    const cached      = await getCached(currentSlug);
    const displayName = cached?.displayName || (currentSlug.replace(/-/g, ' '));
    const logoUrl     = passedLogoUrl || cached?.logoUrl || null;
    const initials    = displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const logoHtml    = logoUrl
      ? `<img class="rcb-logo" src="${logoUrl}" alt="" /><div class="rcb-logo-fallback" style="display:none">${initials}</div>`
      : `<div class="rcb-logo-fallback">${initials}</div>`;
    const empHtml     = currentEmployeeCount ? `<span class="rcb-emp">\uD83D\uDC65 ${currentEmployeeCount}</span>` : '';
    resultsCompanyBanner.innerHTML = `${logoHtml}<span class="rcb-name" id="activeCompanyName">${displayName}</span><button class="rename-company-btn" id="activeCompanyRenameBtn" title="Rename company">✏️</button><span class="rcb-count">${data?.length ?? 0} recruiters</span>${empHtml}`;
    resultsCompanyBanner.style.display = 'flex';
  } else {
    resultsCompanyBanner.style.display = 'none';
  }

  if (!data || data.length === 0) {
    resultsDiv.innerHTML = '<div style="text-align:center;color:#888;font-size:12px;padding:20px 0">No recruiters found.<br>Try on a different company.</div>';
    return;
  }

  const groups = { tech: [], senior: [], general: [], coord: [], talent: [], hiring: [] };
  data.forEach(r => {
    if (r.hiringFrame) { groups.hiring.push(r); return; }
    groups[classify(r.title)].push(r);
  });

  const sectionDefs = [
    { key: 'tech',    label: '\uD83D\uDD35 Technical Recruiters',        cls: '',        badge: 'b-tech',   badgeText: 'Technical'   },
    { key: 'senior',  label: '\uD83D\uDFE3 Senior / Head of Recruiting', cls: 'senior',  badge: 'b-senior', badgeText: 'Senior'      },
    { key: 'general', label: '\uD83D\uDFE2 Recruiters',                  cls: 'general', badge: '',         badgeText: ''            },
    { key: 'coord',   label: '\uD83D\uDFE1 Recruiting Coordinators',     cls: 'coord',   badge: 'b-coord',  badgeText: 'Coordinator' },
    { key: 'talent',  label: '\uD83D\uDC9F Talent',                      cls: 'talent',  badge: 'b-talent', badgeText: 'Talent'      },
    { key: 'hiring',  label: '\uD83D\uDFE0 Hiring Managers (#Hiring)',   cls: 'coord',   badge: 'b-coord',  badgeText: '#Hiring'     },
  ];

  // Show the persistent search wrapper now that results are loaded
  const resultsSearchWrap = document.getElementById('resultsSearchWrap');
  if (resultsSearchWrap) { resultsSearchWrap.style.display = ''; }
  const resultsSearchEl = document.getElementById('resultsSearch');
  if (resultsSearchEl) { resultsSearchEl.value = ''; }
  const clearRSBtn = document.getElementById('clearResultsSearch');
  if (clearRSBtn) clearRSBtn.style.display = 'none';

  let html = `<div class="collapse-controls">
    <div class="collapse-btns">
      <button class="ctrl-btn" id="expandAllSections">\u25BE Expand All</button>
      <button class="ctrl-btn" id="collapseAllSections">\u25B8 Collapse All</button>
      <button class="ctrl-btn open-all-btn" id="openAllRecruiters">\u2197 Open All</button>
      <button class="ctrl-btn" id="copyAllLinks">\uD83D\uDCCB Copy All</button>
    </div>
  </div>
  <div class="copy-selected-row" id="copySelectedRow">
    <button class="ctrl-btn copy-selected-btn" id="copySelectedBtn">\uD83D\uDCCB Copy Selected (<span id="copySelectedCount">0</span>)</button>
    <button class="ctrl-btn clear-selection-btn" id="clearSelectionBtn">\u2715 Clear Selection</button>
  </div>`;
  let copyText = '';
  let secIdx = 0;

  sectionDefs.forEach(({ key, label, cls, badge, badgeText }) => {
    const people = groups[key];
    if (!people.length) return;
    const gid = `sec-${secIdx++}`;
    html += `<div class="section-label" data-gid="${gid}"><span class="section-label-text">${label} (${people.length})</span><span class="section-label-actions"><button class="copy-section-btn" data-gid="${gid}">\uD83D\uDCCB Copy</button><button class="open-section-btn" data-gid="${gid}">\u2197 Open All</button><span class="chevron">\u25BE</span></span></div>`;
    html += `<div class="section-cards" id="${gid}">`;
    people.forEach(r => {
      const badgeHtml  = badge ? `<span class="badge ${badge}">${badgeText}</span>` : '';
      const photoHtml  = r.photoUrl
        ? `<img class="recruiter-photo" src="${r.photoUrl}" alt="" />`
        : '';
      const photoClass = r.photoUrl ? 'has-photo' : '';
      html += `
        <div class="card ${cls} ${photoClass}" data-url="${r.url}" data-name="${r.name}" data-title="${r.title || ''}">
          ${photoHtml}
          <div class="card-name-row"><input type="checkbox" class="recruiter-check" /><div class="card-name">${r.name}${badgeHtml}</div></div>
          <div class="card-title" title="${r.title}">${r.title || '\u2014'}</div>
          <div class="card-url"><a href="${r.url}" target="_blank">${r.url}</a></div>
          <button class="card-copy-btn" data-url="${r.url}">\uD83D\uDD17 Copy Link</button>
          <button class="card-remove-btn" data-url="${r.url}">\u2715 Remove</button>
        </div>`;
      copyText += `${r.name}\n${r.title}\n${r.url}\n\n`;
    });
    html += `</div>`;
  });

  resultsDiv.innerHTML = html;

  // Fix broken images (CSP blocks onerror= attributes)
  resultsDiv.querySelectorAll('img.recruiter-photo').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      img.closest('.card')?.classList.remove('has-photo');
    });
  });

  // Fix results company banner logo
  const rcbLogo = resultsCompanyBanner.querySelector('img.rcb-logo');
  if (rcbLogo) {
    rcbLogo.addEventListener('error', () => {
      rcbLogo.nextElementSibling?.style && (rcbLogo.nextElementSibling.style.display = 'flex');
      rcbLogo.remove();
    });
  }

  document.getElementById('activeCompanyRenameBtn')?.addEventListener('click', async e => {
    e.stopPropagation();
    if (!currentSlug) return;
    const nameEl = document.getElementById('activeCompanyName');
    if (!nameEl) return;
    const current = nameEl.textContent;

    const input = document.createElement('input');
    input.type = 'text';
    input.value = current;
    input.className = 'rename-input';
    nameEl.replaceWith(input);
    e.currentTarget.style.visibility = 'hidden';
    input.focus();
    input.select();

    const save = async () => {
      const newName = input.value.trim() || current;
      await renameCompanyInCache(currentSlug, newName);
      await renderResults(data, passedLogoUrl);
    };

    input.addEventListener('blur', save, { once: true });
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = current; input.blur(); }
    });
  });

  if (copyBtn) { copyBtn.style.display = 'block'; copyBtn.dataset.text = copyText.trim(); }

  // Section collapse toggles
  resultsDiv.querySelectorAll('.section-label').forEach(label => {
    label.addEventListener('click', () => {
      const cards = document.getElementById(label.dataset.gid);
      const isNowCollapsed = cards.classList.toggle('collapsed');
      label.classList.toggle('collapsed', isNowCollapsed);
    });
  });

  document.getElementById('expandAllSections')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.section-cards').forEach(c => c.classList.remove('collapsed'));
    resultsDiv.querySelectorAll('.section-label').forEach(l => l.classList.remove('collapsed'));
  });

  document.getElementById('collapseAllSections')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.section-cards').forEach(c => c.classList.add('collapsed'));
    resultsDiv.querySelectorAll('.section-label').forEach(l => l.classList.add('collapsed'));
  });

  document.getElementById('openAllRecruiters')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.card[data-url]').forEach(card => {
      chrome.tabs.create({ url: card.dataset.url, active: false });
    });
  });

  document.getElementById('copyAllLinks')?.addEventListener('click', () => {
    const urls = [...resultsDiv.querySelectorAll('.card[data-url]')].map(c => c.dataset.url);
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      const btn = document.getElementById('copyAllLinks');
      const orig = btn.textContent;
      btn.textContent = '\u2705 Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });

  function updateCopySelectedBtn() {
    const checked = resultsDiv.querySelectorAll('.recruiter-check:checked');
    const row = document.getElementById('copySelectedRow');
    const countEl = document.getElementById('copySelectedCount');
    if (row) row.classList.toggle('visible', checked.length > 0);
    if (countEl) countEl.textContent = checked.length;
  }

  resultsDiv.querySelectorAll('.recruiter-check').forEach(cb => {
    cb.addEventListener('change', updateCopySelectedBtn);
  });

  document.getElementById('copySelectedBtn')?.addEventListener('click', () => {
    const urls = [...resultsDiv.querySelectorAll('.recruiter-check:checked')].map(cb =>
      cb.closest('.card')?.dataset.url || ''
    ).filter(Boolean);
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      const btn = document.getElementById('copySelectedBtn');
      const orig = btn.innerHTML;
      btn.textContent = '\u2705 Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });
  });

  document.getElementById('clearSelectionBtn')?.addEventListener('click', () => {
    resultsDiv.querySelectorAll('.recruiter-check:checked').forEach(cb => { cb.checked = false; });
    updateCopySelectedBtn();
  });

  resultsDiv.querySelectorAll('.copy-section-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const section = document.getElementById(btn.dataset.gid);
      const urls = [...(section?.querySelectorAll('.card[data-url]') || [])].map(c => c.dataset.url);
      navigator.clipboard.writeText(urls.join('\n')).then(() => {
        const orig = btn.textContent;
        btn.textContent = '\u2705 Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });
  });

  resultsDiv.querySelectorAll('.open-section-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const section = document.getElementById(btn.dataset.gid);
      section?.querySelectorAll('.card[data-url]').forEach(card => {
        chrome.tabs.create({ url: card.dataset.url, active: false });
      });
    });
  });

  // -Live filter ───────────────────────────────────────────────────────────
  function runFilter(term) {
    resultsDiv.querySelectorAll('.card').forEach(card => {
      const rawName  = card.dataset.name  || '';
      const rawTitle = card.dataset.title || '';
      const matches  = !term || rawName.toLowerCase().includes(term) || rawTitle.toLowerCase().includes(term);
      card.style.display = matches ? '' : 'none';
      const nameEl  = card.querySelector('.card-name');
      const titleEl = card.querySelector('.card-title');
      const badge   = nameEl?.querySelector('.badge')?.outerHTML || '';
      if (nameEl)  nameEl.innerHTML  = hl(rawName, term) + badge;
      if (titleEl) titleEl.innerHTML = hl(rawTitle || '\u2014', term);
    });
    resultsDiv.querySelectorAll('.section-cards').forEach(section => {
      const label = resultsDiv.querySelector(`.section-label[data-gid="${section.id}"]`);
      const hasVisible = [...section.querySelectorAll('.card')].some(c => c.style.display !== 'none');
      if (!hasVisible) {
        // Hide entire section (header + cards) when no matches
        section.style.display = 'none';
        if (label) label.style.display = 'none';
      } else {
        // Show section
        section.style.display = '';
        if (label) label.style.display = '';
        // If section was user-collapsed, keep it collapsed (just show the header)
      }
    });
    if (!term) {
      // On clear, restore all hidden sections
      resultsDiv.querySelectorAll('.section-cards').forEach(section => {
        section.style.display = '';
        const label = resultsDiv.querySelector(`.section-label[data-gid="${section.id}"]`);
        if (label) label.style.display = '';
      });
    }
  }

  const _rsEl = document.getElementById('resultsSearch');
  if (_rsEl) {
    const newEl = _rsEl.cloneNode(true);
    _rsEl.parentNode.replaceChild(newEl, _rsEl);
  }
  document.getElementById('resultsSearch')?.addEventListener('input', function () {
    const term = this.value.trim().toLowerCase();
    const clearBtn = document.getElementById('clearResultsSearch');
    if (clearBtn) clearBtn.style.display = term ? '' : 'none';
    runFilter(term);
  });

  document.getElementById('clearResultsSearch')?.addEventListener('click', () => {
    const input = document.getElementById('resultsSearch');
    if (input) { input.value = ''; input.focus(); }
    document.getElementById('clearResultsSearch').style.display = 'none';
    runFilter('');
  });

  resultsDiv.querySelectorAll('.card-copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLink(btn.dataset.url, btn, '\uD83D\uDD17 Copy Link');
    });
  });

  resultsDiv.querySelectorAll('.card-remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const url = btn.dataset.url;
      const card = btn.closest('.card');
      if (card) card.remove();
      if (currentSlug) await removeRecruiterFromCache(currentSlug, url);
      // Rebuild copy-all text from remaining cards
      const remaining = [...resultsDiv.querySelectorAll('.card[data-url]')].map(c => {
        const name  = c.querySelector('.card-name')?.firstChild?.textContent?.trim() || '';
        const title = c.querySelector('.card-title')?.textContent?.trim() || '';
        const u     = c.dataset.url;
        return `${name}\n${title}\n${u}`;
      }).join('\n\n');
      if (copyBtn) { copyBtn.dataset.text = remaining; if (!remaining) copyBtn.style.display = 'none'; }
    });
  });
}

// -Queue renderer ────────────────────────────────────────────────────────────
const queuePanel = document.getElementById('queuePanel');

function renderQueue() {
  if (!currentScanSlug && scanQueue.length === 0) {
    queuePanel.innerHTML = '';
    return;
  }

  const items = [];
  if (currentScanSlug) {
    items.push({ slug: currentScanSlug, state: 'scanning' });
  }
  scanQueue.forEach(({ slug }) => items.push({ slug, state: 'queued' }));

  queuePanel.innerHTML = items.map(({ slug, state }) => {
    const icon = state === 'scanning' ? '\uD83D\uDD04' : '\u23F3';
    const name = slug.replace(/-/g, ' ');
    return `<div class="queue-item ${state}">
      <span class="queue-item-icon">${icon}</span>
      <span class="queue-item-name">${name}</span>
    </div>`;
  }).join('');
}

// -Reactive company change ───────────────────────────────────────────────────
function resetSearchCompanyState() {
  resultsDiv.innerHTML = '';
  resultsCompanyBanner.style.display = 'none';
  const resultsSearchWrap = document.getElementById('resultsSearchWrap');
  if (resultsSearchWrap) resultsSearchWrap.style.display = 'none';
  if (copyBtn) copyBtn.style.display = 'none';
  errorDiv.style.display = 'none';
  progressBar.style.display = 'none';
  progressFill.style.width = '0%';
  currentVisaStatus = null;
  currentExperience = null;
  showCompanyMeta(null);
  showTechStack([]);
}

async function onCompanyChange(slug) {
  if (!slug || slug === currentSlug) return;
  if (isScanning) {
    // Manual scan in progress — update display and show cached results if available
    companyEl.textContent = slug.replace(/-/g, ' ');
    const cachedDuringScan = await getCached(slug);
    if (cachedDuringScan) {
      const age     = Math.round((Date.now() - cachedDuringScan.scannedAt) / 60000);
      const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
      statusBox.textContent = `\u2705 Loaded from cache (scanned ${ageText}). ${cachedDuringScan.recruiters.length} recruiters.`;
      progressBar.style.display = 'block';
      progressFill.style.width = '100%';
      renderResults(cachedDuringScan.recruiters, cachedDuringScan.logoUrl);
      if (copyBtn) copyBtn.style.display = 'block';
      scanBtn.textContent = '\uD83D\uDD04 Re-scan (Queue)';
    } else {
      statusBox.textContent = `\u23F3 Scanning in progress. Click "Add to Queue" to queue ${slug.replace(/-/g, ' ')}.`;
      resultsDiv.innerHTML = '';
      resultsCompanyBanner.style.display = 'none';
      if (copyBtn) copyBtn.style.display = 'none';
    }
    return;
  }

  currentSlug = slug;
  companyEl.textContent = slug.replace(/-/g, ' ');
  resetSearchCompanyState();

  const cached = await getCached(slug);
  if (cached) {
    const age     = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `\u2705 Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width = '100%';
    renderResults(cached.recruiters);
    scanBtn.disabled    = false;
    scanBtn.textContent = '\uD83D\uDD04 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = '\uD83D\uDCA1 Showing cached results. Click "Re-scan" to fetch fresh data.';
  } else {
    if (autoScanToggle.checked) {
      statusBox.textContent = `\u26A1 Auto-scanning ${slug.replace(/-/g, ' ')} in background\u2026`;
    } else {
      statusBox.textContent = `Ready! Click "Find Recruiters" to scan ${slug.replace(/-/g, ' ')}.`;
    }
    scanBtn.disabled    = false;
    scanBtn.textContent = '\uD83D\uDE80 Find Recruiters';
  }
  // Always read employee count, visa status, and tech stack from the current page DOM in parallel
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    getEmployeeCountFromJobPage(activeTab.id).then(async count => {
      const _c = await getCache();
      const existing = _c[slug]?.employeeCount;
      showCompanyMeta(existing || count);
      if (count && !existing) updateCachedEmployeeCount(slug, count);
    });
    getVisaSponsorshipFromJobPage(activeTab.id).then(status => showVisaMeta(status));
    getTechStackFromJobPage(activeTab.id).then(stack => showTechStack(stack));
    getExperienceFromJobPage(activeTab.id).then(exp => showExperienceMeta(exp));
  }
}

// -Listen for background scan completion + Option B observer events ─────────
chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'scanComplete') {
    if (request.companySlug !== currentSlug) return;
    // Background finished scanning the company currently shown — update display
    getCached(request.companySlug).then(cached => {
      if (!cached) return;
      const count = cached.recruiters.length;
      statusBox.textContent = `\u26A1 Auto-scanned! Found ${count} recruiter${count !== 1 ? 's' : ''}.`;
      progressBar.style.display = 'block';
      progressFill.style.width  = '100%';
      if (count > 0) {
        renderResults(cached.recruiters);
        scanBtn.textContent = '\uD83D\uDD04 Re-scan';
      }
    });
  }

  if (request.action === 'profileRecruiterFound') {
    clearTimeout(_profileWaitTimer);
    handleProfileCheckResult({ ...request, status: 'recruiter_found' });
    return;
  }

  if (request.action === 'profileCheckResult') {
    clearTimeout(_profileWaitTimer);
    handleProfileCheckResult(request);
    return;
  }

  if (request.action === 'observedRecruiters') {
    const { companySlug, recruiters } = request;
    if (!recruiters?.length) return;
    // Combine incoming with any previously pending (not-yet-added) recruits for this slug.
    // showObserverNotif re-evaluates the whole set against cache each time,
    // so the banner always reflects the true "spotted but not added" count.
    let combined = recruiters;
    if (_obsPending.slug === companySlug && _obsPending.recruiters.length) {
      const incomingUrls = new Set(recruiters.map(r => r.url));
      const prevOnly = _obsPending.recruiters.filter(r => !incomingUrls.has(r.url));
      combined = [...recruiters, ...prevOnly];
    }
    showObserverNotif(companySlug, combined);
  }
});

// -Poll active tab URL — detects SPA navigation without a content script ─────
let _lastPollUrl = '';
let _lastPeopleUrl = '';
let _peopleRequestTimer = null;
let _lastProfilePollUrl = '';
let _lastCompanyPageSlug = '';
let _lastTabUrl = '';
let _profileWaitTimer = null;

function resetProfileUiState() {
  profileNotif.classList.remove('visible');
  profileNotifAddBtn.style.display = '';
  errorDiv.style.display = 'none';
}

function requestProfileCheck(tabId, withReconnect = false) {
  clearTimeout(_profileWaitTimer);
  resetProfileUiState();
  statusBox.textContent = 'Checking profile…';

  const send = () => chrome.tabs.sendMessage(tabId, { action: 'requestProfileState' });

  send().catch(async () => {
    if (!withReconnect) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['aliases.js', 'content/content-core.js', 'content/profile-content.js'] });
      setTimeout(() => chrome.tabs.sendMessage(tabId, { action: 'requestProfileState' }).catch(() => {}), 400);
    } catch {
      statusBox.textContent = '⚠️ Reload this LinkedIn tab to reconnect the extension.';
    }
  });

  _profileWaitTimer = setTimeout(() => {
    if (statusBox.textContent === 'Checking profile…') {
      statusBox.textContent = '⚠️ Could not read this profile yet. Refresh the panel or reload the LinkedIn tab.';
    }
  }, 7000);
}

setInterval(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // -Refresh panel on any URL change ──────────────────────────────────────
  if (tab?.url && tab.url !== _lastTabUrl) {
    _lastTabUrl = tab.url;
    initPanel();
    return;
  }

  // -People tab URL change detector ───────────────────────────────────────
  // When the URL changes on a company people page (new keyword search, filter, etc.)
  // ask the content script for a fresh scrape 2s later (DOM needs time to settle).
  // This bypasses the content.js pushState timing entirely.
  if (tab?.url?.match(/linkedin\.com\/company\/[^/?#]+\/people/)) {
    if (tab.url !== _lastPeopleUrl) {
      _lastPeopleUrl = tab.url;
      clearTimeout(_peopleRequestTimer);
      _peopleRequestTimer = setTimeout(() => {
        chrome.tabs.sendMessage(tab.id, { action: 'requestPeopleState' }).catch(() => {});
      }, 2000);
    }
  }

  if (tab?.url?.match(/linkedin\.com\/in\/[^/?#]+/)) {
    if (tab.url !== _lastProfilePollUrl) {
      _lastProfilePollUrl = tab.url;
      requestProfileCheck(tab.id);
    }
  }

  // Case 1: company page (not people tab) → auto-load cache if available
  const companyPageM = tab?.url?.match(/linkedin\.com\/company\/([^/?#]+)/);
  if (companyPageM && !tab.url.includes('/people')) {
    const slug = companyPageM[1].toLowerCase();
    if (slug !== _lastCompanyPageSlug) {
      _lastCompanyPageSlug = slug;
      onCompanyChange(slug);
    }
  }

  if (!tab?.url?.includes('linkedin.com/jobs')) return;
  if (tab.url === _lastPollUrl) return;
  _lastPollUrl = tab.url;

  // Wait for the DOM to settle after SPA navigation, then detect company
  setTimeout(async () => {
    const [freshTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!freshTab) return;
    let slug = extractCompanySlug(freshTab);
    if (!slug) {
      try { slug = await getCompanySlugFromJobPage(freshTab.id); } catch (e) {}
    }
    if (!slug) return;
    if (slug !== currentSlug) {
      onCompanyChange(slug);
    } else if (!isScanning) {
      // Same company, different job — refresh only job-specific meta
      getVisaSponsorshipFromJobPage(freshTab.id).then(status => showVisaMeta(status));
      getTechStackFromJobPage(freshTab.id).then(stack => showTechStack(stack));
      getExperienceFromJobPage(freshTab.id).then(exp => showExperienceMeta(exp));
    }
  }, 400);
}, 300);

// -On panel open / refresh ───────────────────────────────────────────────────
async function initPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  resetProfileUiState();
  if (!url.includes('linkedin.com')) {
    handleExternalPage(tab);
    return;
  }

  // Try to detect company slug from current URL or page
  let slug = extractCompanySlug(tab);
  if (!slug) {
    try { slug = await getCompanySlugFromJobPage(tab.id); } catch (e) {}
  }

  if (!slug) {
    // Profile page: trigger content script re-check instead of showing generic message
    if (tab.url?.match(/linkedin\.com\/in\/[^/?#]+/)) {
      currentSlug = null;
      companyEl.textContent = '';
      resetSearchCompanyState();
      requestProfileCheck(tab.id, true);
    } else {
      currentSlug = null;
      companyEl.textContent = '';
      resetSearchCompanyState();
      statusBox.textContent = 'Ready! Click "Find Recruiters" from any LinkedIn job posting.';
    }
    return;
  }

  companyEl.textContent = slug.replace(/-/g, ' ');
  currentSlug = slug;
  _onJobPage = /linkedin\.com\/jobs\/view\/\d+/.test(url) || /[?&]currentJobId=\d+/.test(url);
  resetSearchCompanyState();

  // Check if a manual scan for this company is still running in the background
  const sd = await new Promise(r =>
    chrome.storage.session.get(['manualScanSlug', 'manualScanDone', 'status', 'manualScanQueue'], r)
  );

  // Restore any pending queue that survived a panel close
  const savedQueue = Array.isArray(sd.manualScanQueue) ? sd.manualScanQueue : [];
  savedQueue.forEach(s => {
    if (!scanQueue.some(q => q.slug === s)) scanQueue.push({ slug: s });
  });

  if (sd.manualScanSlug && !sd.manualScanDone) {
    // Scan is in progress — show scanning state and wait for it to finish
    statusBox.textContent = sd.status || `Scanning ${sd.manualScanSlug.replace(/-/g, ' ')}...`;
    progressBar.style.display = 'block';
    progressFill.style.width = '30%';
    scanBtn.disabled = false;
    scanBtn.textContent = '\u2795 Add to Queue';
    isScanning = true;
    currentScanSlug = sd.manualScanSlug;
    currentSlug = sd.manualScanSlug;
    companyEl.textContent = sd.manualScanSlug.replace(/-/g, ' ');
    renderQueue();
    pollForManualScanCompletion(sd.manualScanSlug);
    return;
  }

  // Scan finished while panel was closed — restore queue and continue
  if (savedQueue.length > 0) {
    isScanning = true;
    processQueue();
    return;
  }

  const cached = await getCached(slug);
  if (cached) {
    const age     = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `\u2705 Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width  = '100%';
    renderResults(cached.recruiters);
    scanBtn.textContent = '\uD83D\uDD04 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = '\uD83D\uDCA1 Showing cached results. Click "Re-scan" to fetch fresh data.';
  } else {
    statusBox.textContent = `Ready! Click "Find Recruiters" to scan ${slug.replace(/-/g, ' ')}.`;
  }
  // Always read employee count, visa status, and tech stack from the current page DOM in parallel
  getEmployeeCountFromJobPage(tab.id).then(async count => {
    const _c = await getCache();
    const existing = _c[slug]?.employeeCount;
    showCompanyMeta(existing || count);
    if (count && !existing) updateCachedEmployeeCount(slug, count);
  });
  getVisaSponsorshipFromJobPage(tab.id).then(status => showVisaMeta(status));
  getTechStackFromJobPage(tab.id).then(stack => showTechStack(stack));
  getExperienceFromJobPage(tab.id).then(exp => showExperienceMeta(exp));

  // Option B: if the active tab is on a company people page, ask content script
  // for whatever recruiters are currently visible (restores state after panel reopen)
  if (tab.url?.match(/linkedin\.com\/company\/[^/?#]+\/people/)) {
    chrome.tabs.sendMessage(tab.id, { action: 'requestPeopleState' }).catch(() => {});
  }

  // Profile page: ask content script to re-check the current profile
  if (tab.url?.match(/linkedin\.com\/in\/[^/?#]+/)) {
    requestProfileCheck(tab.id);
  }
}

document.getElementById('refreshPanelBtn').addEventListener('click', () => {
  // Visually reset meta/tech info so the user sees it reload
  currentEmployeeCount = null;
  currentVisaStatus    = null;
  currentExperience    = null;
  companyMetaEl.style.display = 'none';
  techStackEl.style.display   = 'none';
  statusBox.textContent = 'Refreshing\u2026';

  // Reset poll trackers so the interval re-fires on next tick
  _lastPollUrl         = '';
  _lastPeopleUrl       = '';
  _lastProfilePollUrl  = '';
  _lastCompanyPageSlug = '';

  initPanel();
});
