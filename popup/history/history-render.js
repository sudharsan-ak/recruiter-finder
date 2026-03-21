let _historySortMode = 'latest';

async function renderHistoryPreservingState(filter = '') {
  const openSlugs = [...historyList.querySelectorAll('.history-recruiters.open')]
    .map(el => el.id.replace(/^hist-/, ''));
  const scrollTop = historyList.scrollTop;

  await renderHistory(filter);

  openSlugs.forEach(slug => {
    document.getElementById(`hist-${slug}`)?.classList.add('open');
  });
  historyList.scrollTop = scrollTop;
}

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
      r.name.toLowerCase().includes(lf) ||
      (r.title || '').toLowerCase().includes(lf) ||
      (r.email || '').toLowerCase().includes(lf)
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
          const email = (r.email || '').trim().toLowerCase();
          return `
            <div class="history-recruiter-row" id="hr-${slug}-${encodeURIComponent(r.url)}" data-url="${r.url}">
              <input type="checkbox" class="h-check" data-url="${r.url}" />
              ${photo}
              <div class="h-info">
                <div class="h-name-row">
                  <span class="h-name">${hl(r.name, lf)}</span>
                  ${email ? `<span class="h-email">${hl(email, lf)}</span>` : ''}
                </div>
                <span class="h-title">${hl(r.title || '—', lf)}</span>
              </div>
              <div class="h-actions">
                <span class="h-link"><a href="${r.url}" target="_blank">Profile →</a></span>
                <button class="h-copy-link" data-url="${r.url}" title="Copy profile link">🔗</button>
                ${email ? `<button class="h-copy-email" data-email="${email}" title="Copy email">✉</button>` : ''}
                <button class="h-edit-email" data-slug="${slug}" data-url="${r.url}" data-email="${email}" title="${email ? 'Edit email' : 'Add email'}">${email ? '✏️' : '＋Email'}</button>
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
          <div class="history-recruiter-list${recruiters.length > 5 ? ' is-scrollable' : ''}">
            ${rows}
          </div>
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

  document.querySelectorAll('.history-company-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.classList.contains('delete-entry-btn')) return;
      const target = document.getElementById(`hist-${header.dataset.slug}`);
      const willOpen = !target.classList.contains('open');
      historyList.querySelectorAll('.history-recruiters.open').forEach(el => el.classList.remove('open'));
      if (willOpen) target.classList.add('open');
    });
  });

  document.querySelectorAll('.copy-history-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(decodeURIComponent(btn.dataset.copy)).then(() => {
        btn.textContent = '✅ Copied!';
        setTimeout(() => { btn.textContent = '📋 Copy All'; }, 2000);
      });
    });
  });

  document.querySelectorAll('.open-history-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const latestCache = await getCache();
      const recruiters = latestCache[btn.dataset.slug]?.recruiters || [];
      recruiters.forEach(r => chrome.tabs.create({ url: r.url, active: false }));
    });
  });

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

  document.querySelectorAll('.h-copy-link').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLink(btn.dataset.url, btn, '🔗');
    });
  });

  document.querySelectorAll('.h-copy-email').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLink(btn.dataset.email, btn, '✉');
    });
  });

  document.querySelectorAll('.h-edit-email').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.editing === 'true') return;
      btn.dataset.editing = 'true';
      const current = btn.dataset.email || '';
      const input = document.createElement('input');
      input.type = 'email';
      input.className = 'h-email-input';
      input.placeholder = 'name@company.com';
      input.value = current;
      btn.replaceWith(input);
      input.focus();
      input.select();

      const restoreButton = () => renderHistoryPreservingState(historySearch.value);

      const save = async () => {
        const normalized = input.value.trim().toLowerCase();
        if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
          globalThis.setHistoryActionStatus?.('Invalid email address');
          restoreButton();
          return;
        }
        const updated = await upsertRecruiterEmail(btn.dataset.slug, btn.dataset.url, normalized);
        if (!updated) {
          globalThis.setHistoryActionStatus?.('Could not update recruiter email');
          restoreButton();
          return;
        }
        globalThis.setHistoryActionStatus?.(normalized ? 'Recruiter email updated' : 'Recruiter email cleared');
        renderHistoryPreservingState(historySearch.value);
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter') {
          e2.preventDefault();
          input.blur();
        }
        if (e2.key === 'Escape') {
          e2.preventDefault();
          restoreButton();
        }
      });
    });
  });

  document.querySelectorAll('.h-delete-recruiter').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { slug, url } = btn.dataset;
      await removeRecruiterFromCache(slug, url);
      const rowId = `hr-${slug}-${encodeURIComponent(url)}`;
      const row = document.getElementById(rowId);
      if (row) row.remove();
      const meta = document.querySelector(`#hc-${slug} .history-meta`);
      if (meta) {
        const remaining = document.querySelectorAll(`#hist-${slug} .history-recruiter-row`).length;
        meta.innerHTML = meta.innerHTML.replace(/^\d+/, remaining);
      }
    });
  });

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

  document.querySelectorAll('.remove-alias-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await removeAlias(btn.dataset.slug, btn.dataset.alias);
      btn.closest('.alias-chip').remove();
    });
  });

  function wireAddAliasBtn(addBtn) {
    addBtn.addEventListener('click', e => {
      e.stopPropagation();
      const slug  = addBtn.dataset.slug;
      const row   = addBtn.closest('.history-aliases-row');
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'alias name…';
      input.className = 'alias-input';
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
            ev.stopPropagation();
            await removeAlias(slug, val);
            chip.remove();
          });
          row.insertBefore(chip, input);
        }
        const newBtn = document.createElement('button');
        newBtn.className = 'add-alias-btn';
        newBtn.dataset.slug = slug;
        newBtn.textContent = '＋';
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

  document.querySelectorAll('.rename-company-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const slug    = btn.dataset.slug;
      const nameEl  = document.getElementById(`hn-${slug}`);
      const current = nameEl.textContent;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = current;
      input.className = 'rename-input';
      nameEl.replaceWith(input);
      btn.style.visibility = 'hidden';
      input.focus();
      input.select();

      const save = async () => {
        const newName = input.value.trim() || current;
        await renameCompanyInCache(slug, newName);
        const newEl = document.createElement('div');
        newEl.className = 'history-company-name';
        newEl.id = `hn-${slug}`;
        newEl.textContent = newName;
        input.replaceWith(newEl);
        btn.style.visibility = '';
      };

      input.addEventListener('blur', save);
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter')  { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { input.value = current; input.blur(); }
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
