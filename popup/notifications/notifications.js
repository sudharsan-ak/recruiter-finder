// -Profile page recruiter notification state ─────────────────────────────────
let _profileRecruiter = null;
let _obsPending = { slug: null, recruiters: [] };

// -Profile page recruiter notification ──────────────────────────────────────

function setProfileNotif(text, buttonText = '', showButton = false) {
  profileNotifText.textContent = text;
  profileNotifAddBtn.textContent = buttonText;
  profileNotifAddBtn.style.display = showButton ? '' : 'none';
  profileNotif.classList.add('visible');
}

async function showProfileNotif({ name, title, url, companySlug, companyName, photoUrl = null }) {
  const cached = await getCached(companySlug);

  // Case 3: company has cache → load it into the panel automatically
  if (cached?.recruiters?.length) onCompanyChange(companySlug);

  if (cached) {
    const alreadyIn = cached.recruiters.some(r => normalizeUrl(r.url) === normalizeUrl(url));
    if (alreadyIn) {
      _profileRecruiter = null;
      statusBox.textContent = `Checked profile: ${name} is already in your ${companyName} cache.`;
      errorDiv.style.display = 'none';
      setProfileNotif(`👤 ${name} is already in your ${companyName} cache.`, '', false);
      return;
    }
    _profileRecruiter = { name, title, url, companySlug, companyName, photoUrl, mode: 'add' };
    statusBox.textContent = `Checked profile: ${name} is not in your ${companyName} cache yet.`;
    errorDiv.style.display = 'none';
    setProfileNotif(`👤 ${name} · not in your ${companyName} list yet`, `➕ Add to ${companyName}`, true);
  } else {
    _profileRecruiter = { name, title, url, companySlug, companyName, photoUrl, mode: 'new' };
    if (companySlug) onCompanyChange(companySlug);
    statusBox.textContent = `Checked profile: ${companyName} is not in cache yet.`;
    errorDiv.style.display = 'none';
    setProfileNotif(`👤 ${name} · ${companyName} is not in cache yet`, '➕ Save recruiter', true);
  }
}

function hideProfileNotif() {
  profileNotif.classList.remove('visible');
  profileNotifAddBtn.style.display = '';
  _profileRecruiter = null;
}

profileNotifDismiss.addEventListener('click', hideProfileNotif);

profileNotifAddBtn.addEventListener('click', async () => {
  if (!_profileRecruiter) return;
  const { name, title, url, companySlug, companyName, photoUrl, mode } = _profileRecruiter;
  const recruiter = { name, title, url, photoUrl: photoUrl || null };
  const cache = await new Promise(r => chrome.storage.local.get(CACHE_KEY, r));
  const history = cache[CACHE_KEY] || {};
  if (mode === 'add') {
    const existing = history[companySlug] || { recruiters: [] };
    const existingUrls = new Set(existing.recruiters.map(r => normalizeUrl(r.url)));
    const merged = existingUrls.has(normalizeUrl(url)) ? existing.recruiters : [...existing.recruiters, recruiter];
    await saveToCache(companySlug, merged, existing.logoUrl || null);
    if (companySlug === currentSlug) {
      renderResults(merged);
      statusBox.textContent = `✅ Added ${name}! ${merged.length} recruiters total.`;
    }
  } else {
    // New company entry with just this one recruiter
    await saveToCache(companySlug, [recruiter], null);
    if (companyName) await renameCompanyInCache(companySlug, companyName);
    statusBox.textContent = `✅ Saved ${name} under ${companyName}.`;
  }
  hideProfileNotif();
});

function handleProfileCheckResult(result) {
  const { status, name = 'This person', title = '', reason = '' } = result || {};

  if (status === 'recruiter_found') {
    errorDiv.style.display = 'none';
    showProfileNotif(result);
    return;
  }

  hideProfileNotif();

  if (status === 'not_recruiter') {
    statusBox.textContent = `Checked profile: ${name} does not appear to be a recruiter.`;
    errorDiv.style.display = 'none';
    return;
  }

  if (status === 'company_unresolved') {
    statusBox.textContent = `⚠️ Recruiter detected, but the current company could not be resolved.`;
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#c0392b';
    errorDiv.textContent = reason || `Could not resolve a canonical company slug for ${name}${title ? ` (${title})` : ''}.`;
    return;
  }

  statusBox.textContent = '⚠️ Could not determine the profile state.';
  if (reason) {
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#c0392b';
    errorDiv.textContent = reason;
  }
}

function updateObserverNotif() {
  const { slug, recruiters } = _obsPending;
  if (!slug || !recruiters.length) { observerNotif.classList.remove('visible'); return; }
  const displayName = slug.replace(/-/g, ' ');
  const n = recruiters.length;
  obsText.textContent = `👤 ${n} new recruiter${n !== 1 ? 's' : ''} spotted at ${displayName}`;
  observerNotif.classList.add('visible');
}

function normalizeUrl(url) {
  return (url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
}

async function showObserverNotif(slug, recruiters) {
  // Filter to only recruiters not already saved in cache for this company.
  // Normalize both sides (trailing slash, query params, case) to avoid mismatches.
  const cached = await getCached(slug);
  const cachedUrls = new Set((cached?.recruiters || []).map(r => normalizeUrl(r.url)));
  const newOnes = recruiters.filter(r => !cachedUrls.has(normalizeUrl(r.url)));
  if (!newOnes.length) {
    // Everything has been added — make sure banner is hidden
    observerNotif.classList.remove('visible');
    _obsPending = { slug: null, recruiters: [] };
    return;
  }
  _obsPending = { slug, recruiters: newOnes };
  updateObserverNotif(); // shows banner with updated count
  // If modal is already open for this slug, refresh its list
  if (observerModal.classList.contains('open') && _obsModalSlug === slug) {
    populateObsModal();
  }
}

function hideObserverNotif() {
  observerNotif.classList.remove('visible');
  _obsPending = { slug: null, recruiters: [] };
}

// -Observer modal ────────────────────────────────────────────────────────────
let _obsModalSlug = null;

function populateObsModal() {
  const { slug, recruiters } = _obsPending;
  _obsModalSlug = slug;
  const displayName = slug.replace(/-/g, ' ');
  obsModalTitle.textContent = `👤 New Recruiters at ${displayName}`;
  obsModalList.innerHTML = recruiters.map((r, i) => `
    <div class="obs-row">
      <input type="checkbox" class="obs-check" data-i="${i}" checked />
      <div class="obs-row-info">
        <div class="obs-row-name">${r.name}</div>
        <div class="obs-row-title">${r.title || ''}</div>
      </div>
    </div>`).join('');
  updateObsModalCount();
  obsModalList.querySelectorAll('.obs-check').forEach(cb =>
    cb.addEventListener('change', updateObsModalCount)
  );
}

function updateObsModalCount() {
  const n = obsModalList.querySelectorAll('.obs-check:checked').length;
  obsModalSelCount.textContent = n;
}

obsShowBtn.addEventListener('click', () => {
  if (!_obsPending.slug) return;
  populateObsModal();
  observerModal.classList.add('open');
});

obsDismissBtn.addEventListener('click', async () => {
  // Tell content script to un-mark these URLs so the observer can re-detect them
  const urls = _obsPending.recruiters.map(r => r.url);
  if (urls.length) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) chrome.tabs.sendMessage(tab.id, { action: 'unmarkObservedUrls', urls }).catch(() => {});
  }
  hideObserverNotif();
});

obsModalCloseBtn.addEventListener('click', () => {
  observerModal.classList.remove('open');
  _obsModalSlug = null;
});

obsModalAddBtn.addEventListener('click', async () => {
  const { slug } = _obsPending;
  if (!slug) return;
  const checked = [...obsModalList.querySelectorAll('.obs-check:checked')];
  const indices = new Set(checked.map(cb => parseInt(cb.dataset.i)));
  const toAdd      = _obsPending.recruiters.filter((_, i) => indices.has(i));
  const remaining  = _obsPending.recruiters.filter((_, i) => !indices.has(i));
  if (!toAdd.length) return;

  // Merge selected into cache
  const cache = await getCache();
  const existing = cache[slug]?.recruiters || [];
  const existingUrls = new Set(existing.map(r => normalizeUrl(r.url)));
  const merged = [...existing, ...toAdd.filter(r => !existingUrls.has(normalizeUrl(r.url)))];
  await saveToCache(slug, merged, cache[slug]?.logoUrl || null);

  // Update pending — keep unselected ones
  _obsPending.recruiters = remaining;
  observerModal.classList.remove('open');
  _obsModalSlug = null;
  updateObserverNotif(); // hide banner if nothing left, else update count

  if (slug === currentSlug) {
    renderResults(merged);
    statusBox.textContent = `✅ Added ${toAdd.length}! ${merged.length} recruiter${merged.length !== 1 ? 's' : ''} total.`;
  }
});

obsSelectAll.addEventListener('click', () => {
  obsModalList.querySelectorAll('.obs-check').forEach(cb => { cb.checked = true; });
  updateObsModalCount();
});

obsDeselectAll.addEventListener('click', () => {
  obsModalList.querySelectorAll('.obs-check').forEach(cb => { cb.checked = false; });
  updateObsModalCount();
});
