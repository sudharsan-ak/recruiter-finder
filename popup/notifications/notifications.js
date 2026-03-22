let _profileRecruiter = null;
let _obsPending = { slug: null, recruiters: [] };
let _obsModalSlug = null;

function normalizeUrl(url) {
  return (url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
}

function normalizeCompanySlugInput(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function suggestCompanySlug(value) {
  return normalizeCompanySlugInput(value);
}

function setProfileNotif({
  text = '',
  subtext = '',
  buttonText = '',
  showButton = false,
  editableCompany = false,
  companyValue = ''
} = {}) {
  profileNotifText.textContent = text;
  profileNotifSubtext.textContent = subtext;
  profileNotifAddBtn.textContent = buttonText;
  profileNotifAddBtn.style.display = showButton ? '' : 'none';
  profileNotifEditWrap.style.display = editableCompany ? 'flex' : 'none';
  if (editableCompany) profileCompanyInput.value = companyValue || '';
  profileNotif.classList.add('visible');
}

function hideProfileNotif() {
  profileNotif.classList.remove('visible');
  profileNotifAddBtn.style.display = '';
  profileNotifEditWrap.style.display = 'none';
  profileNotifText.textContent = '';
  profileNotifSubtext.textContent = '';
  _profileRecruiter = null;
}

function setProfileInlineCompanyEditor(companyName, { placeholder = 'Enter company...', onInput = null } = {}) {
  currentEmployeeCount = null;
  currentVisaStatus = null;
  currentExperience = null;
  companyEl.textContent = companyName || '';
  companyMetaEl.innerHTML = '';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = companyName || '';
  input.className = 'profile-inline-company-input';
  input.placeholder = placeholder;
  input.addEventListener('input', () => {
    const value = input.value.trim();
    companyEl.textContent = value;
    if (onInput) {
      onInput(value);
    } else if (_profileRecruiter) {
      _profileRecruiter.companyName = value;
    }
  });

  companyMetaEl.appendChild(input);
  companyMetaEl.style.display = 'flex';
}

function showProfileManualCacheCheck({ name, title, url, companyName = '', photoUrl = null, reason = '', mode = 'manual_check' }) {
  const suggestedSlug = suggestCompanySlug(companyName);
  _profileRecruiter = {
    name,
    title,
    url,
    companyName,
    photoUrl,
    mode,
    overrideSlug: suggestedSlug,
  };
  statusBox.textContent = reason || 'Enter a company slug to check this profile against your cache.';
  errorDiv.style.display = 'none';
  scanBtn.disabled = false;
  scanBtn.textContent = 'Check Cache';
  setProfileInlineCompanyEditor(suggestedSlug, {
    placeholder: 'Enter company slug...',
    onInput: value => {
      const normalized = normalizeCompanySlugInput(value);
      companyEl.textContent = normalized;
      if (_profileRecruiter) _profileRecruiter.overrideSlug = normalized;
    }
  });
  setProfileNotif({
    text: companyName
      ? `Auto-detection was not enough for ${name}.`
      : `${name} does not appear to be a recruiter.`,
    subtext: companyName
      ? `Enter a company slug to check whether this profile is in your cache.`
      : 'If you know the company slug, enter it and check your cache manually.',
    showButton: false,
    editableCompany: false
  });
}

async function showProfileNotif({ name, title, url, companySlug, companyName, photoUrl = null }) {
  const cached = await getCached(companySlug);

  if (cached?.recruiters?.length) onCompanyChange(companySlug);

  if (cached) {
    const alreadyIn = cached.recruiters.some(r => normalizeUrl(r.url) === normalizeUrl(url));
    if (alreadyIn) {
      _profileRecruiter = null;
      statusBox.textContent = `Checked profile: ${name} is already in your ${companyName} cache.`;
      errorDiv.style.display = 'none';
      setProfileNotif({
        text: `${name} is already in your ${companyName} cache.`,
        subtext: '',
        showButton: false,
        editableCompany: false
      });
      return;
    }

    _profileRecruiter = { name, title, url, companySlug, companyName, photoUrl, mode: 'add' };
    statusBox.textContent = `Checked profile: ${name} is not in your ${companyName} cache yet.`;
    errorDiv.style.display = 'none';
    setProfileNotif({
      text: `${name} is not in your ${companyName} cache yet.`,
      subtext: 'Add this recruiter to the existing company cache?',
      buttonText: `Add to ${companyName}`,
      showButton: true,
      editableCompany: false
    });
    return;
  }

  _profileRecruiter = { name, title, url, companySlug, companyName, photoUrl, mode: 'new' };
  statusBox.textContent = `Checked profile: ${companyName} is not in cache yet.`;
  errorDiv.style.display = 'none';
  scanBtn.disabled = false;
  scanBtn.textContent = 'Scan';
  setProfileInlineCompanyEditor(companyName);
  setProfileNotif({
    text: `${companyName} is not in cache yet`,
    subtext: `Recruiter detected: ${name}`,
    showButton: false,
    editableCompany: false
  });
}

async function refreshProfileRecruiterState(slug, displayName) {
  if (!_profileRecruiter) return;
  _profileRecruiter.companySlug = slug || _profileRecruiter.companySlug;
  _profileRecruiter.companyName = displayName || _profileRecruiter.companyName;
  await showProfileNotif(_profileRecruiter);
}

globalThis.refreshProfileRecruiterState = refreshProfileRecruiterState;

profileNotifDismiss.addEventListener('click', hideProfileNotif);

profileNotifAddBtn.addEventListener('click', async () => {
  if (!_profileRecruiter) return;
  const { name, title, url, companySlug, companyName, photoUrl, mode } = _profileRecruiter;
  const recruiter = { name, title, url, photoUrl: photoUrl || null };
  const cacheData = await new Promise(r => chrome.storage.local.get(CACHE_KEY, r));
  const history = cacheData[CACHE_KEY] || {};

  if (mode === 'add') {
    const existing = history[companySlug] || { recruiters: [] };
    const existingUrls = new Set(existing.recruiters.map(r => normalizeUrl(r.url)));
    const merged = existingUrls.has(normalizeUrl(url)) ? existing.recruiters : [...existing.recruiters, recruiter];
    await saveToCache(companySlug, merged, existing.logoUrl || null);
    if (companySlug === currentSlug) {
      renderResults(merged);
      statusBox.textContent = `Added ${name}. ${merged.length} recruiters total.`;
    }
  } else {
    await saveToCache(companySlug, [recruiter], null);
    if (companyName) await renameCompanyInCache(companySlug, companyName);
    statusBox.textContent = `Saved ${name} under ${companyName}.`;
  }
  hideProfileNotif();
});

function handleProfileCheckResult(result) {
  const { status, name = 'This person', title = '', reason = '', url = '', companyName = '', photoUrl = null } = result || {};

  if (status === 'recruiter_found') {
    errorDiv.style.display = 'none';
    showProfileNotif(result);
    return;
  }

  hideProfileNotif();

  if (status === 'not_recruiter') {
    showProfileManualCacheCheck({
      name,
      title,
      url,
      companyName,
      photoUrl,
      reason: `Checked profile: ${name} does not appear to be a recruiter.`,
      mode: 'manual_check'
    });
    return;
  }

  if (status === 'company_unresolved') {
    showProfileManualCacheCheck({
      name,
      title,
      url,
      companyName,
      photoUrl,
      reason: 'Recruiter detected, but the company slug could not be resolved automatically.',
      mode: 'manual_check'
    });
    return;
  }

  statusBox.textContent = 'Could not determine the profile state.';
  if (reason) {
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#c0392b';
    errorDiv.textContent = reason;
  }
}

async function handleManualProfileCacheCheck() {
  if (!_profileRecruiter) return;
  const input = document.querySelector('.profile-inline-company-input');
  const slug = normalizeCompanySlugInput(input?.value || _profileRecruiter.overrideSlug || companyEl.textContent || '');
  if (!slug) {
    statusBox.textContent = 'Enter a company slug to check cache.';
    return;
  }

  _profileRecruiter.overrideSlug = slug;
  _profileRecruiter.companySlug = slug;
  companyEl.textContent = slug;
  const cached = await getCached(slug);
  if (!cached) {
    statusBox.textContent = `No cache found for ${slug.replace(/-/g, ' ')}.`;
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = 'Try another company slug if you know it, or click "Scan This Company".';
    _profileRecruiter.mode = 'manual_scan_slug';
    scanBtn.disabled = false;
    scanBtn.textContent = 'Scan This Company';
    return;
  }

  errorDiv.style.display = 'none';
  await showProfileNotif({
    name: _profileRecruiter.name,
    title: _profileRecruiter.title,
    url: _profileRecruiter.url,
    companySlug: slug,
    companyName: cached.displayName || _profileRecruiter.companyName || slug.replace(/-/g, ' '),
    photoUrl: _profileRecruiter.photoUrl || null,
  });
}

globalThis.handleManualProfileCacheCheck = handleManualProfileCacheCheck;

function updateObserverNotif() {
  const { slug, recruiters } = _obsPending;
  if (!slug || !recruiters.length) {
    observerNotif.classList.remove('visible');
    return;
  }
  const displayName = slug.replace(/-/g, ' ');
  const n = recruiters.length;
  obsText.textContent = `${n} new recruiter${n !== 1 ? 's' : ''} spotted at ${displayName}`;
  observerNotif.classList.add('visible');
}

async function showObserverNotif(slug, recruiters) {
  const cached = await getCached(slug);
  const cachedUrls = new Set((cached?.recruiters || []).map(r => normalizeUrl(r.url)));
  const newOnes = recruiters.filter(r => !cachedUrls.has(normalizeUrl(r.url)));
  if (!newOnes.length) {
    observerNotif.classList.remove('visible');
    _obsPending = { slug: null, recruiters: [] };
    return;
  }
  _obsPending = { slug, recruiters: newOnes };
  updateObserverNotif();
  if (observerModal.classList.contains('open') && _obsModalSlug === slug) {
    populateObsModal();
  }
}

function hideObserverNotif() {
  observerNotif.classList.remove('visible');
  _obsPending = { slug: null, recruiters: [] };
}

function populateObsModal() {
  const { slug, recruiters } = _obsPending;
  _obsModalSlug = slug;
  const displayName = slug.replace(/-/g, ' ');
  obsModalTitle.textContent = `New Recruiters at ${displayName}`;
  obsModalList.innerHTML = recruiters.map((r, i) => `
    <div class="obs-row">
      <input type="checkbox" class="obs-check" data-i="${i}" checked />
      <div class="obs-row-info">
        <div class="obs-row-name">${r.name}</div>
        <div class="obs-row-title">${r.title || ''}</div>
      </div>
    </div>`).join('');
  updateObsModalCount();
  obsModalList.querySelectorAll('.obs-check').forEach(cb => cb.addEventListener('change', updateObsModalCount));
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
  const toAdd = _obsPending.recruiters.filter((_, i) => indices.has(i));
  const remaining = _obsPending.recruiters.filter((_, i) => !indices.has(i));
  if (!toAdd.length) return;

  const cache = await getCache();
  const existing = cache[slug]?.recruiters || [];
  const existingUrls = new Set(existing.map(r => normalizeUrl(r.url)));
  const merged = [...existing, ...toAdd.filter(r => !existingUrls.has(normalizeUrl(r.url)))];
  await saveToCache(slug, merged, cache[slug]?.logoUrl || null);

  _obsPending.recruiters = remaining;
  observerModal.classList.remove('open');
  _obsModalSlug = null;
  updateObserverNotif();

  if (slug === currentSlug) {
    renderResults(merged);
    statusBox.textContent = `Added ${toAdd.length}. ${merged.length} recruiters total.`;
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
