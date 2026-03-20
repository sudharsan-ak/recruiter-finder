function classify(title) {
  const t = (title || '').toLowerCase();
  if (/technical|tech\b|sourcing|sourcer/.test(t)) return 'tech';
  if (/head\b|director|vp\b|vice president|lead\b|senior/.test(t)) return 'senior';
  if (/coord/i.test(t)) return 'coord';
  if (/\btalent\b|\bacquisition\b/.test(t)) return 'talent';
  return 'general';
}

function hl(text, term) {
  if (!term || !text) return text || '';
  const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${safe})`, 'gi'), '<mark class="hl">$1</mark>');
}

async function renderResults(data, passedLogoUrl = null) {
  if (currentSlug) {
    const cached = await getCached(currentSlug);
    const displayName = cached?.displayName || currentSlug.replace(/-/g, ' ');
    const logoUrl = passedLogoUrl || cached?.logoUrl || null;
    const initials = displayName.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const logoHtml = logoUrl
      ? `<img class="rcb-logo" src="${logoUrl}" alt="" /><div class="rcb-logo-fallback" style="display:none">${initials}</div>`
      : `<div class="rcb-logo-fallback">${initials}</div>`;
    const empHtml = currentEmployeeCount ? `<span class="rcb-emp">👥 ${currentEmployeeCount}</span>` : '';
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
    if (r.hiringFrame) {
      groups.hiring.push(r);
      return;
    }
    groups[classify(r.title)].push(r);
  });

  const sectionDefs = [
    { key: 'tech', label: '🔵 Technical Recruiters', cls: '', badge: 'b-tech', badgeText: 'Technical' },
    { key: 'senior', label: '🟣 Senior / Head of Recruiting', cls: 'senior', badge: 'b-senior', badgeText: 'Senior' },
    { key: 'general', label: '🟢 Recruiters', cls: 'general', badge: '', badgeText: '' },
    { key: 'coord', label: '🟡 Recruiting Coordinators', cls: 'coord', badge: 'b-coord', badgeText: 'Coordinator' },
    { key: 'talent', label: '💟 Talent', cls: 'talent', badge: 'b-talent', badgeText: 'Talent' },
    { key: 'hiring', label: '🟠 Hiring Managers (#Hiring)', cls: 'coord', badge: 'b-coord', badgeText: '#Hiring' },
  ];

  const resultsSearchWrap = document.getElementById('resultsSearchWrap');
  if (resultsSearchWrap) resultsSearchWrap.style.display = '';
  const resultsSearchEl = document.getElementById('resultsSearch');
  if (resultsSearchEl) resultsSearchEl.value = '';
  const clearRSBtn = document.getElementById('clearResultsSearch');
  if (clearRSBtn) clearRSBtn.style.display = 'none';

  let html = `<div class="collapse-controls">
    <div class="collapse-btns">
      <button class="ctrl-btn" id="expandAllSections">▾ Expand All</button>
      <button class="ctrl-btn" id="collapseAllSections">▸ Collapse All</button>
      <button class="ctrl-btn open-all-btn" id="openAllRecruiters">↗ Open All</button>
      <button class="ctrl-btn" id="copyAllLinks">📋 Copy All</button>
    </div>
  </div>
  <div class="copy-selected-row" id="copySelectedRow">
    <button class="ctrl-btn copy-selected-btn" id="copySelectedBtn">📋 Copy Selected (<span id="copySelectedCount">0</span>)</button>
    <button class="ctrl-btn clear-selection-btn" id="clearSelectionBtn">✕ Clear Selection</button>
  </div>`;
  let copyText = '';
  let secIdx = 0;

  sectionDefs.forEach(({ key, label, cls, badge, badgeText }) => {
    const people = groups[key];
    if (!people.length) return;
    const gid = `sec-${secIdx++}`;
    html += `<div class="section-label" data-gid="${gid}"><span class="section-label-text">${label} (${people.length})</span><span class="section-label-actions"><button class="copy-section-btn" data-gid="${gid}">📋 Copy</button><button class="open-section-btn" data-gid="${gid}">↗ Open All</button><span class="chevron">▾</span></span></div>`;
    html += `<div class="section-cards" id="${gid}">`;
    people.forEach(r => {
      const badgeHtml = badge ? `<span class="badge ${badge}">${badgeText}</span>` : '';
      const photoHtml = r.photoUrl ? `<img class="recruiter-photo" src="${r.photoUrl}" alt="" />` : '';
      const photoClass = r.photoUrl ? 'has-photo' : '';
      html += `
        <div class="card ${cls} ${photoClass}" data-url="${r.url}" data-name="${r.name}" data-title="${r.title || ''}">
          ${photoHtml}
          <div class="card-name-row"><input type="checkbox" class="recruiter-check" /><div class="card-name">${r.name}${badgeHtml}</div></div>
          <div class="card-title" title="${r.title}">${r.title || '—'}</div>
          <div class="card-url"><a href="${r.url}" target="_blank">${r.url}</a></div>
          <button class="card-copy-btn" data-url="${r.url}">🔗 Copy Link</button>
          <button class="card-remove-btn" data-url="${r.url}">✕ Remove</button>
        </div>`;
      copyText += `${r.name}\n${r.title}\n${r.url}\n\n`;
    });
    html += `</div>`;
  });

  resultsDiv.innerHTML = html;

  resultsDiv.querySelectorAll('img.recruiter-photo').forEach(img => {
    img.addEventListener('error', () => {
      img.style.display = 'none';
      img.closest('.card')?.classList.remove('has-photo');
    });
  });

  const rcbLogo = resultsCompanyBanner.querySelector('img.rcb-logo');
  if (rcbLogo) {
    rcbLogo.addEventListener('error', () => {
      if (rcbLogo.nextElementSibling?.style) rcbLogo.nextElementSibling.style.display = 'flex';
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

  if (copyBtn) {
    copyBtn.style.display = 'block';
    copyBtn.dataset.text = copyText.trim();
  }

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
      btn.textContent = '✅ Copied!';
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
    const urls = [...resultsDiv.querySelectorAll('.recruiter-check:checked')]
      .map(cb => cb.closest('.card')?.dataset.url || '')
      .filter(Boolean);
    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      const btn = document.getElementById('copySelectedBtn');
      const orig = btn.innerHTML;
      btn.textContent = '✅ Copied!';
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
        btn.textContent = '✅ Copied!';
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

  function runFilter(term) {
    resultsDiv.querySelectorAll('.card').forEach(card => {
      const rawName = card.dataset.name || '';
      const rawTitle = card.dataset.title || '';
      const matches = !term || rawName.toLowerCase().includes(term) || rawTitle.toLowerCase().includes(term);
      card.style.display = matches ? '' : 'none';
      const nameEl = card.querySelector('.card-name');
      const titleEl = card.querySelector('.card-title');
      const badge = nameEl?.querySelector('.badge')?.outerHTML || '';
      if (nameEl) nameEl.innerHTML = hl(rawName, term) + badge;
      if (titleEl) titleEl.innerHTML = hl(rawTitle || '—', term);
    });

    resultsDiv.querySelectorAll('.section-cards').forEach(section => {
      const label = resultsDiv.querySelector(`.section-label[data-gid="${section.id}"]`);
      const hasVisible = [...section.querySelectorAll('.card')].some(c => c.style.display !== 'none');
      if (!hasVisible) {
        section.style.display = 'none';
        if (label) label.style.display = 'none';
      } else {
        section.style.display = '';
        if (label) label.style.display = '';
      }
    });

    if (!term) {
      resultsDiv.querySelectorAll('.section-cards').forEach(section => {
        section.style.display = '';
        const label = resultsDiv.querySelector(`.section-label[data-gid="${section.id}"]`);
        if (label) label.style.display = '';
      });
    }
  }

  const existingSearch = document.getElementById('resultsSearch');
  if (existingSearch) {
    const newEl = existingSearch.cloneNode(true);
    existingSearch.parentNode.replaceChild(newEl, existingSearch);
  }

  document.getElementById('resultsSearch')?.addEventListener('input', function () {
    const term = this.value.trim().toLowerCase();
    const clearBtn = document.getElementById('clearResultsSearch');
    if (clearBtn) clearBtn.style.display = term ? '' : 'none';
    runFilter(term);
  });

  document.getElementById('clearResultsSearch')?.addEventListener('click', () => {
    const input = document.getElementById('resultsSearch');
    if (input) {
      input.value = '';
      input.focus();
    }
    document.getElementById('clearResultsSearch').style.display = 'none';
    runFilter('');
  });

  resultsDiv.querySelectorAll('.card-copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      copyLink(btn.dataset.url, btn, '🔗 Copy Link');
    });
  });

  resultsDiv.querySelectorAll('.card-remove-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const url = btn.dataset.url;
      const card = btn.closest('.card');
      if (card) card.remove();
      if (currentSlug) await removeRecruiterFromCache(currentSlug, url);
      const remaining = [...resultsDiv.querySelectorAll('.card[data-url]')].map(c => {
        const name = c.querySelector('.card-name')?.firstChild?.textContent?.trim() || '';
        const title = c.querySelector('.card-title')?.textContent?.trim() || '';
        const u = c.dataset.url;
        return `${name}\n${title}\n${u}`;
      }).join('\n\n');
      if (copyBtn) {
        copyBtn.dataset.text = remaining;
        if (!remaining) copyBtn.style.display = 'none';
      }
    });
  });
}
