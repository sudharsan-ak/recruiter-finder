const queuePanel = document.getElementById('queuePanel');

function renderQueue() {
  if (!currentScanSlug && scanQueue.length === 0) {
    queuePanel.innerHTML = '';
    return;
  }

  const items = [];
  if (currentScanSlug) items.push({ slug: currentScanSlug, state: 'scanning' });
  scanQueue.forEach(({ slug }) => items.push({ slug, state: 'queued' }));

  queuePanel.innerHTML = items.map(({ slug, state }) => {
    const icon = state === 'scanning' ? '🔄' : '⏳';
    const name = slug.replace(/-/g, ' ');
    return `<div class="queue-item ${state}">
      <span class="queue-item-icon">${icon}</span>
      <span class="queue-item-name">${name}</span>
    </div>`;
  }).join('');
}

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
  setExternalCompanyEdit(false);
  showCompanyMeta(null);
  showTechStack([]);
}

async function onCompanyChange(slug) {
  if (!slug || slug === currentSlug) return;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (isScanning) {
    currentSlug = slug;
    _onJobPage = !!activeTab?.url && (/linkedin\.com\/jobs\/view\/\d+/.test(activeTab.url) || /[?&]currentJobId=\d+/.test(activeTab.url));
    companyEl.textContent = slug.replace(/-/g, ' ');
    currentEmployeeCount = null;
    currentVisaStatus = null;
    currentExperience = null;
    showCompanyMeta(null);
    showTechStack([]);

    if (activeTab) {
      getEmployeeCountFromJobPage(activeTab.id).then(async count => {
        const cache = await getCache();
        const existing = cache[slug]?.employeeCount;
        showCompanyMeta(existing || count);
        if (count && !existing) updateCachedEmployeeCount(slug, count);
      });
      getVisaSponsorshipFromJobPage(activeTab.id).then(status => showVisaMeta(status));
      getTechStackFromJobPage(activeTab.id).then(stack => showTechStack(stack));
      getExperienceFromJobPage(activeTab.id).then(exp => showExperienceMeta(exp));
    }

    const cachedDuringScan = await getCached(slug);
    if (cachedDuringScan) {
      const age = Math.round((Date.now() - cachedDuringScan.scannedAt) / 60000);
      const ageText = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.floor(age / 1440)}d ${Math.floor((age % 1440) / 60)}h ago`;
      statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cachedDuringScan.recruiters.length} recruiters.`;
      progressBar.style.display = 'block';
      progressFill.style.width = '100%';
      renderResults(cachedDuringScan.recruiters, cachedDuringScan.logoUrl);
      if (copyBtn) copyBtn.style.display = 'block';
      scanBtn.textContent = '🔄 Re-scan (Queue)';
    } else {
      statusBox.textContent = `⏳ Scanning in progress. Click "Add to Queue" to queue ${slug.replace(/-/g, ' ')}.`;
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
    const age = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : age < 1440 ? `${Math.round(age / 60)}h ago` : `${Math.floor(age / 1440)}d ${Math.floor((age % 1440) / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width = '100%';
    renderResults(cached.recruiters);
    scanBtn.disabled = false;
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = '💡 Showing cached results. Click "Re-scan" to fetch fresh data.';
  } else {
    if (autoScanToggle.checked) {
      statusBox.textContent = `⚡ Auto-scanning ${slug.replace(/-/g, ' ')} in background...`;
    } else {
      statusBox.textContent = `Ready! Click "Find Recruiters" to scan ${slug.replace(/-/g, ' ')}.`;
    }
    scanBtn.disabled = false;
    scanBtn.textContent = '🚀 Find Recruiters';
  }

  if (activeTab) {
    getEmployeeCountFromJobPage(activeTab.id).then(async count => {
      const cache = await getCache();
      const existing = cache[slug]?.employeeCount;
      showCompanyMeta(existing || count);
      if (count && !existing) updateCachedEmployeeCount(slug, count);
    });
    getVisaSponsorshipFromJobPage(activeTab.id).then(status => showVisaMeta(status));
    getTechStackFromJobPage(activeTab.id).then(stack => showTechStack(stack));
    getExperienceFromJobPage(activeTab.id).then(exp => showExperienceMeta(exp));
  }
}
