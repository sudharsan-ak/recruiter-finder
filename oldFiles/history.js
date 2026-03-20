// -Add Recruiter Modal ───────────────────────────────────────────────────────
const modal        = document.getElementById('addRecruiterModal');
const modalError   = document.getElementById('modalError');
const modalSaveBtn = document.getElementById('modalSaveBtn');

function openAddRecruiterModal() {
  ['mName','mTitle','mUrl','mCompany','mCompanyUrl'].forEach(id => {
    document.getElementById(id).value = '';
  });
  modalError.textContent = '';
  modal.classList.add('open');
  document.getElementById('mName').focus();
}

function closeModal() {
  modal.classList.remove('open');
}

// -Backfill missing logos for cached companies ───────────────────────────────
async function backfillLogos() {
  const cache = await getCache();
  const missing = Object.keys(cache).filter(slug => !cache[slug].logoUrl);
  if (missing.length === 0) return;

  for (const slug of missing) {
    try {
      // Ask background to open a real tab, extract logo via scripting, and close it.
      // This works because background has an authenticated LinkedIn session.
      const response = await new Promise(resolve =>
        chrome.runtime.sendMessage({ action: 'fetchLogo', companySlug: slug }, resolve)
      );
      const logo = response?.logoUrl || null;

      if (logo) {
        const fresh = await getCache();
        if (fresh[slug] && !fresh[slug].logoUrl) {
          fresh[slug].logoUrl = logo;
          await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: fresh }, r));
          // Swap the fallback letter-div for a real img in the rendered history row
          const fallback = document.querySelector(`#hc-${slug} .company-logo-fallback`);
          if (fallback) {
            const img = document.createElement('img');
            img.className = 'company-logo';
            img.src = logo;
            img.alt = '';
            img.addEventListener('error', () => img.replaceWith(fallback));
            fallback.replaceWith(img);
          }
        }
      }
    } catch (e) {}
  }
}

// -History rendering ─────────────────────────────────────────────────────────
let _historySortMode = 'latest';

function compareHistoryEntries(a, b, cache) {
  const entryA = cache[a];
  const entryB = cache[b];

  if (_historySortMode === 'oldest') {
    return (entryA.scannedAt || 0) - (entryB.scannedAt || 0);
  }

  if (_historySortMode === 'az' || _historySortMode === 'za') {
    const nameA = (entryA.displayName || a).toLowerCase();
    const nameB = (entryB.displayName || b).toLowerCase();
    const cmp = nameA.localeCompare(nameB);
    return _historySortMode === 'za' ? -cmp : cmp;
  }

  return (entryB.scannedAt || 0) - (entryA.scannedAt || 0);
}

async function renderHistory(filter = '') {
  const cache = await getCache();
  const keys  = Object.keys(cache).sort((a, b) => compareHistoryEntries(a, b, cache));
  const lf    = filter.toLowerCase();

  // -Stats bar ────────────────────────────────────────────────────────────────
  const historyStats = document.getElementById('historyStats');
  if (historyStats && keys.length > 0) {
    const totalRecruiters = keys.reduce((s, k) => s + cache[k].recruiters.length, 0);
    const lastTs  = Math.max(...keys.map(k => cache[k].scannedAt));
    const lastMin = Math.round((Date.now() - lastTs) / 60000);
    const lastStr = lastMin < 60
      ? `${lastMin}m ago`
      : lastMin < 1440
        ? `${Math.round(lastMin / 60)}h ago`
        : `${Math.round(lastMin / 1440)}d ago`;
    historyStats.textContent = `${keys.length} companies · ${totalRecruiters} recruiters · Last scan ${lastStr}`;
    historyStats.style.display = 'block';
  } else if (historyStats) {
    historyStats.style.display = 'none';
  }

  const filtered = keys.filter(slug => {
    if (!lf) return true;
    const entry = cache[slug];
    if ((entry.displayName || slug).toLowerCase().includes(lf)) return true;
    return entry.recruiters.some(r =>
      r.name.toLowerCase().includes(lf) || (r.title || '').toLowerCase().includes(lf)
    );
  });

  if (filtered.length === 0) {
    historyList.innerHTML = `<div class="empty-history">${lf ? 'No matches found.' : 'No history yet.<br>Run a scan to populate this.'}</div>`;
    return;
  }

  historyList.innerHTML = filtered.map(slug => {
    const entry      = cache[slug];
    const dateStr    = new Date(entry.scannedAt).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const recruiters  = entry.recruiters;
    const copyText    = recruiters.map(r => r.url).join('\n');

    const rows = recruiters.length > 0
      ? recruiters.map(r => {
          const photo = r.photoUrl
            ? `<img class="h-photo" src="${r.photoUrl}" alt="" />`
            : '';
          return `
            <div class="history-recruiter-row" id="hr-${slug}-${encodeURIComponent(r.url)}" data-url="${r.url}">
              <input type="checkbox" class="h-check" data-url="${r.url}" />
              ${photo}
              <div class="h-info">
                <span class="h-name">${hl(r.name, lf)}</span>
                <span class="h-title">${hl(r.title || '—', lf)}</span>
              </div>
              <div class="h-actions">
                <span class="h-link"><a href="${r.url}" target="_blank">Profile →</a></span>
                <button class="h-copy-link" data-url="${r.url}" title="Copy profile link">🔗</button>
                <button class="h-delete-recruiter" data-slug="${slug}" data-url="${r.url}" title="Remove from history">🗑</button>
              </div>
            </div>`;
        }).join('')
      : '<div style="font-size:11px;color:#aaa;padding:4px 0">No recruiters found in this scan.</div>';

    const displayName = entry.displayName || slug.replace(/-/g, ' ');
    const initials    = displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const logoHtml    = entry.logoUrl
      ? `<img class="company-logo" src="${entry.logoUrl}" alt="" data-initials="${initials}" />`
      : `<div class="company-logo-fallback">${initials}</div>`;

    return `
      <div class="history-company" id="hc-${slug}">
        <div class="history-company-header" data-slug="${slug}">
          <div class="history-company-name-wrap">
            ${logoHtml}
            <div class="history-company-name" id="hn-${slug}">${hl(displayName, lf)}</div>
            ${entry.employeeCount ? `<span class="history-emp-count">(${fmtEmpCount(entry.employeeCount)})</span>` : ''}
            <button class="rename-company-btn" data-slug="${slug}" title="Rename company">✏️</button>
          </div>
          <div class="history-meta">${recruiters.length} recruiters<br>${dateStr}</div>
          <button class="delete-entry-btn" data-slug="${slug}" title="Delete this entry">🗑</button>
        </div>
        <div class="history-recruiters" id="hist-${slug}">
          <div class="history-aliases-row" data-slug="${slug}">
            <span class="aliases-label">Alt names:</span>
            ${(entry.aliases || []).map(a =>
              `<span class="alias-chip">${a}<button class="remove-alias-btn" data-slug="${slug}" data-alias="${a}">×</button></span>`
            ).join('')}
            <button class="add-alias-btn" data-slug="${slug}">＋</button>
          </div>
          ${rows}
          ${recruiters.length > 0
            ? `<div class="history-company-actions">
                <button class="copy-history-selected-btn" data-slug="${slug}" style="display:none">📋 Copy Selected</button>
                <button class="clear-history-selected-btn" data-slug="${slug}" style="display:none">✕ Clear</button>
                <button class="copy-history-btn" data-copy="${encodeURIComponent(copyText)}">📋 Copy All</button>
                <button class="open-history-btn" data-slug="${slug}">↗ Open All</button>
               </div>`
            : ''}
        </div>
      </div>
    `;
  }).join('');

  // Fix broken images (CSP blocks onerror= attributes)
  historyList.querySelectorAll('img.company-logo').forEach(img => {
    img.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = 'company-logo-fallback';
      fallback.textContent = img.dataset.initials || '?';
      img.replaceWith(fallback);
    });
  });
  historyList.querySelectorAll('img.h-photo').forEach(img => {
    img.addEventListener('error', () => { img.style.display = 'none'; });
  });

  // Toggle expand/collapse
  document.querySelectorAll('.history-company-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-entry-btn')) return;
      document.getElementById(`hist-${header.dataset.slug}`).classList.toggle('open');
    });
  });

  // Copy all text per company
  document.querySelectorAll('.copy-history-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(decodeURIComponent(btn.dataset.copy)).then(() => {
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy All'; }, 2000);
      });
    });
  });

  // Open All per company
  document.querySelectorAll('.open-history-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const cache = await getCache();
      const recruiters = cache[btn.dataset.slug]?.recruiters || [];
      recruiters.forEach(r => chrome.tabs.create({ url: r.url, active: false }));
    });
  });

  // Checkbox selection → show/hide selection bar
  function updateHistSelectionBar() {
    const checked = historyList.querySelectorAll('.h-check:checked');
    const bar = document.getElementById('historySelectionBar');
    const countEl = document.getElementById('histSelCount');
    bar?.classList.toggle('visible', checked.length > 0);
    if (countEl) countEl.textContent = `${checked.length} selected`;

    historyList.querySelectorAll('.history-company').forEach(card => {
      const companyChecked = card.querySelectorAll('.h-check:checked');
      const copyBtn = card.querySelector('.copy-history-selected-btn');
      const clearBtn = card.querySelector('.clear-history-selected-btn');
      if (copyBtn) copyBtn.style.display = companyChecked.length > 0 ? '' : 'none';
      if (clearBtn) clearBtn.style.display = companyChecked.length > 0 ? '' : 'none';
    });
  }
  document.querySelectorAll('.h-check').forEach(cb => {
    cb.addEventListener('change', e => { e.stopPropagation(); updateHistSelectionBar(); });
  });

  document.getElementById('histCopySelected')?.addEventListener('click', () => {
    const urls = [...historyList.querySelectorAll('.h-check:checked')].map(cb => cb.dataset.url);
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      const btn = document.getElementById('histCopySelected');
      const orig = btn.textContent;
      btn.textContent = '✅ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });
  });

  document.getElementById('histOpenSelected')?.addEventListener('click', () => {
    historyList.querySelectorAll('.h-check:checked').forEach(cb => {
      chrome.tabs.create({ url: cb.dataset.url, active: false });
    });
  });

  document.querySelectorAll('.copy-history-selected-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slug = btn.dataset.slug;
      const urls = [...historyList.querySelectorAll(`#hist-${slug} .h-check:checked`)].map(cb => cb.dataset.url);
      navigator.clipboard.writeText(urls.join('\n')).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });
  });

  document.querySelectorAll('.clear-history-selected-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slug = btn.dataset.slug;
      historyList.querySelectorAll(`#hist-${slug} .h-check:checked`).forEach(cb => { cb.checked = false; });
      updateHistSelectionBar();
    });
  });

  // Per-recruiter copy link
  document.querySelectorAll('.h-copy-link').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLink(btn.dataset.url, btn, '🔗');
    });
  });

  // Per-recruiter delete
  document.querySelectorAll('.h-delete-recruiter').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { slug, url } = btn.dataset;
      await removeRecruiterFromCache(slug, url);
      const rowId = `hr-${slug}-${encodeURIComponent(url)}`;
      const row = document.getElementById(rowId);
      if (row) row.remove();
      // Update recruiter count in header
      const meta = document.querySelector(`#hc-${slug} .history-meta`);
      if (meta) {
        const remaining = document.querySelectorAll(`#hist-${slug} .history-recruiter-row`).length;
        meta.innerHTML = meta.innerHTML.replace(/^\d+/, remaining);
      }
    });
  });

  // Per-entry delete
  document.querySelectorAll('.delete-entry-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const slug = btn.dataset.slug;
      await deleteFromCache(slug);
      const card = document.getElementById(`hc-${slug}`);
      if (card) card.remove();
      if (document.querySelectorAll('.history-company').length === 0) {
        historyList.innerHTML = '<div class="empty-history">No history yet.<br>Run a scan to populate this.</div>';
      }
    });
  });

  // Remove alias
  document.querySelectorAll('.remove-alias-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await removeAlias(btn.dataset.slug, btn.dataset.alias);
      btn.closest('.alias-chip').remove();
    });
  });

  // Add alias
  function wireAddAliasBtn(addBtn) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const slug  = addBtn.dataset.slug;
      const row   = addBtn.closest('.history-aliases-row');
      const input = document.createElement('input');
      input.type = 'text'; input.placeholder = 'alias name…'; input.className = 'alias-input';
      addBtn.replaceWith(input);
      input.focus();

      input.addEventListener('blur', async () => {
        const val = input.value.trim().toLowerCase();
        if (val) {
          await addAlias(slug, val);
          const chip = document.createElement('span');
          chip.className = 'alias-chip';
          chip.innerHTML = `${val}<button class="remove-alias-btn" data-slug="${slug}" data-alias="${val}">×</button>`;
          chip.querySelector('.remove-alias-btn').addEventListener('click', async ev => {
            ev.stopPropagation(); await removeAlias(slug, val); chip.remove();
          });
          row.insertBefore(chip, input);
        }
        const newBtn = document.createElement('button');
        newBtn.className    = 'add-alias-btn';
        newBtn.dataset.slug = slug;
        newBtn.textContent  = '＋';
        input.replaceWith(newBtn);
        wireAddAliasBtn(newBtn);
      });
      input.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter')  { e2.preventDefault(); input.blur(); }
        if (e2.key === 'Escape') { input.value = ''; input.blur(); }
      });
    });
  }
  document.querySelectorAll('.add-alias-btn').forEach(wireAddAliasBtn);

  // Rename company
  document.querySelectorAll('.rename-company-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slug    = btn.dataset.slug;
      const nameEl  = document.getElementById(`hn-${slug}`);
      const current = nameEl.textContent;

      const input = document.createElement('input');
      input.type      = 'text';
      input.value     = current;
      input.className = 'rename-input';
      nameEl.replaceWith(input);
      btn.style.visibility = 'hidden';
      input.focus();
      input.select();

      const save = async () => {
        const newName = input.value.trim() || current;
        await renameCompanyInCache(slug, newName);
        const newEl       = document.createElement('div');
        newEl.className   = 'history-company-name';
        newEl.id          = `hn-${slug}`;
        newEl.textContent = newName;
        input.replaceWith(newEl);
        btn.style.visibility = '';
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = current; input.blur(); }
      });
    });
  });
}

historySearch.addEventListener('input', () => {
  clearSearchBtn.style.display = historySearch.value ? 'block' : 'none';
  renderHistory(historySearch.value);
});

const historySort = document.getElementById('historySort');

chrome.storage.local.get(['historySortMode'], ({ historySortMode }) => {
  _historySortMode = historySortMode || 'latest';
  if (historySort) historySort.value = _historySortMode;
});

historySort?.addEventListener('change', () => {
  _historySortMode = historySort.value || 'latest';
  chrome.storage.local.set({ historySortMode: _historySortMode });
  globalThis.setHistoryActionStatus?.(`Sorted: ${historySort.options[historySort.selectedIndex]?.text || _historySortMode}`);
  renderHistory(historySearch.value);
});

clearSearchBtn.addEventListener('click', () => {
  historySearch.value = '';
  clearSearchBtn.style.display = 'none';
  renderHistory();
  historySearch.focus();
});

clearHistBtn.addEventListener('click', async () => {
  if (!confirm('Clear all history? This cannot be undone.')) return;
  await chrome.storage.local.remove(CACHE_KEY);
  globalThis.setHistoryActionStatus?.('History cleared');
  renderHistory();
});

addRecruiterBtn.addEventListener('click', openAddRecruiterModal);

refreshLogosBtn.addEventListener('click', async () => {
  globalThis.setHistoryActionStatus?.('Refreshing logos…', 0);
  refreshLogosBtn.textContent = '⏳ Fetching...';
  refreshLogosBtn.disabled = true;
  await backfillLogos();
  globalThis.setHistoryActionStatus?.('Refresh logos done');
  refreshLogosBtn.textContent = '✅ Done';
  setTimeout(() => {
    refreshLogosBtn.textContent = '🖼 Refresh Logos';
    refreshLogosBtn.disabled = false;
  }, 2000);
});

document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

modalSaveBtn.addEventListener('click', async () => {
  const name       = document.getElementById('mName').value.trim();
  const title      = document.getElementById('mTitle').value.trim();
  const url        = document.getElementById('mUrl').value.trim();
  const company    = document.getElementById('mCompany').value.trim();
  const companyUrl = document.getElementById('mCompanyUrl').value.trim();

  if (!name)    { modalError.textContent = 'Name is required.'; return; }
  if (!url)     { modalError.textContent = 'Profile URL is required.'; return; }
  if (!company) { modalError.textContent = 'Company name is required.'; return; }
  if (!url.includes('linkedin.com/in/')) {
    modalError.textContent = 'Profile URL must be a LinkedIn /in/ URL.';
    return;
  }

  // Derive slug from company URL if given, else from company name
  let slug = null;
  if (companyUrl) {
    const m = companyUrl.match(/linkedin\.com\/company\/([^/?#]+)/);
    if (m) slug = m[1].toLowerCase().replace(/\/$/, '');
  }
  if (!slug) slug = company.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  // Normalise profile URL
  const profileUrl = url.split('?')[0].replace(/\/$/, '') + '/';

  const cache = await getCache();
  if (cache[slug]) {
    // Append to existing company — avoid duplicates
    const exists = cache[slug].recruiters.some(r => r.url === profileUrl);
    if (exists) { modalError.textContent = 'This profile is already saved for this company.'; return; }
    cache[slug].recruiters.push({ name, title, url: profileUrl, photoUrl: '' });
  } else {
    // Create new company entry
    cache[slug] = {
      recruiters: [{ name, title, url: profileUrl, photoUrl: '' }],
      logoUrl: null,
      scannedAt: Date.now(),
      displayName: company,
    };
  }

  await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: cache }, r));
  closeModal();
  globalThis.setHistoryActionStatus?.('Recruiter added');
  renderHistory(historySearch.value);
});
