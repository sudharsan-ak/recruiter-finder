let _lastPollUrl = '';
let _lastPeopleUrl = '';
let _peopleRequestTimer = null;
let _lastCompanyPageSlug = '';
let _lastTabUrl = '';
let _lastTabId = null;

setInterval(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (tab?.id !== _lastTabId || (tab?.url && tab.url !== _lastTabUrl)) {
    _lastTabId = tab?.id ?? null;
    _lastTabUrl = tab.url;
    initPanel();
    return;
  }

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
      getVisaSponsorshipFromJobPage(freshTab.id).then(status => showVisaMeta(status));
      getTechStackFromJobPage(freshTab.id).then(stack => showTechStack(stack));
      getExperienceFromJobPage(freshTab.id).then(exp => showExperienceMeta(exp));
    }
  }, 400);
}, 300);

async function initPanel() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  _lastTabId  = tab?.id  ?? null;
  _lastTabUrl = tab?.url ?? '';
  const url = tab?.url || '';
  resetProfileUiState();

  if (!url.includes('linkedin.com')) {
    let host = '';
    try { host = new URL(url).hostname; } catch (e) {}
    if (host === 'mail.google.com') {
      currentSlug = null;
      companyEl.textContent = '';
      resetSearchCompanyState();
      statusBox.textContent = 'Ready! Open a LinkedIn page or supported job posting to use the extension.';
      return;
    }
    if (/^(chrome|chrome-extension|edge|about):/i.test(url)) {
      currentSlug = null;
      companyEl.textContent = '';
      _onJobPage = false;
      currentEmployeeCount = null;
      currentVisaStatus = null;
      currentExperience = null;
      currentTechStack = null;
      setExternalCompanyEdit(true);
      statusBox.textContent = 'Enter a company name and click "Scan".';
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan';
      errorDiv.style.display = 'none';
      progressBar.style.display = 'none';
      progressFill.style.width = '0%';
      resultsDiv.innerHTML = '';
      resultsCompanyBanner.style.display = 'none';
      if (copyBtn) copyBtn.style.display = 'none';
      return;
    }
    handleExternalPage(tab);
    return;
  }

  let slug = extractCompanySlug(tab);
  if (!slug) {
    try { slug = await getCompanySlugFromJobPage(tab.id); } catch (e) {}
  }

  if (!slug) {
    if (tab.url?.match(/linkedin\.com\/in\/[^/?#]+/)) {
      currentSlug = null;
      companyEl.textContent = '';
      resetSearchCompanyState();
      _lastProfilePollUrl = tab.url;
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
  if (_onJobPage) {
    const dm = url.match(/linkedin\.com\/jobs\/view\/(\d+)/);
    const jm = dm || url.match(/[?&]currentJobId=(\d+)/);
    _currentJobUrl = jm ? `https://www.linkedin.com/jobs/view/${jm[1]}/` : url;
  }
  resetSearchCompanyState();

  const sd = await new Promise(r =>
    chrome.storage.session.get(['manualScanSlug', 'manualScanDone', 'status', 'manualScanQueue'], r)
  );

  const savedQueue = Array.isArray(sd.manualScanQueue) ? sd.manualScanQueue : [];
  savedQueue.forEach(s => {
    if (!scanQueue.some(q => q.slug === s)) scanQueue.push({ slug: s });
  });

  if (sd.manualScanSlug && !sd.manualScanDone) {
    statusBox.textContent = sd.status || `Scanning ${sd.manualScanSlug.replace(/-/g, ' ')}...`;
    progressBar.style.display = 'block';
    progressFill.style.width = '30%';
    scanBtn.disabled = false;
    scanBtn.textContent = 'Add to Queue';
    isScanning = true;
    currentScanSlug = sd.manualScanSlug;
    currentSlug = sd.manualScanSlug;
    companyEl.textContent = sd.manualScanSlug.replace(/-/g, ' ');
    renderQueue();
    pollForManualScanCompletion(sd.manualScanSlug);
    return;
  }

  if (savedQueue.length > 0) {
    isScanning = true;
    processQueue();
    return;
  }

  const cached = await getCached(slug);
  if (cached) {
    const age = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width = '100%';
    renderResults(cached.recruiters);
    scanBtn.textContent = 'Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = 'Showing cached results. Click "Re-scan" to fetch fresh data.';
  } else {
    statusBox.textContent = `Ready! Click "Find Recruiters" to scan ${slug.replace(/-/g, ' ')}.`;
    scanBtn.disabled = false;
    scanBtn.textContent = 'Find Recruiters';
  }

  getEmployeeCountFromJobPage(tab.id).then(async count => {
    const cache = await getCache();
    const existing = cache[slug]?.employeeCount;
    showCompanyMeta(existing || count);
    if (count && !existing) updateCachedEmployeeCount(slug, count);
  });
  getVisaSponsorshipFromJobPage(tab.id).then(status => showVisaMeta(status));
  getTechStackFromJobPage(tab.id).then(stack => showTechStack(stack));
  getExperienceFromJobPage(tab.id).then(exp => showExperienceMeta(exp));

  if (tab.url?.match(/linkedin\.com\/company\/[^/?#]+\/people/)) {
    chrome.tabs.sendMessage(tab.id, { action: 'requestPeopleState' }).catch(() => {});
  }

  if (tab.url?.match(/linkedin\.com\/in\/[^/?#]+/)) {
    requestProfileCheck(tab.id);
  }
}
