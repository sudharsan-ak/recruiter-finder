let detectedExternalCompanyName = null; // set on init; used when button is clicked

function extractCompanyNameFromUrl(url) {
  let m;
  m = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  m = url.match(/boards\.greenhouse\.io\/([^/?#]+)/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  m = url.match(/ats\.rippling\.com\/([^/?#]+)/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  m = url.match(/^https?:\/\/([^.]+)\.[^.]*\.myworkdayjobs\.com/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  m = url.match(/apply\.workable\.com\/([^/?#]+)/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  m = url.match(/jobs\.smartrecruiters\.com\/([^/?#]+)/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  m = url.match(/app\.dover\.com\/apply\/([^/?#]+)/);
  if (m) return m[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return null;
}

async function extractCompanyNameFromPage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const d = JSON.parse(s.textContent);
            const objs = Array.isArray(d) ? d : [d];
            for (const obj of objs) {
              const name = obj?.hiringOrganization?.name;
              if (name) return name;
              if (obj?.['@type'] === 'Organization' && obj?.name) return obj.name;
            }
          } catch (e) {}
        }

        const ogSite = document.querySelector('meta[property="og:site_name"]')?.content;
        if (ogSite) return ogSite;

        const url = window.location.href;
        let um;
        um = url.match(/jobs\.lever\.co\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/boards\.greenhouse\.io\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/ats\.rippling\.com\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/^https?:\/\/([^.]+)\.[^.]*\.myworkdayjobs\.com/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        um = url.match(/apply\.workable\.com\/([^/?#]+)/);
        if (um) return um[1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        const title = document.title || '';
        let m2 = title.match(/\bat\s+([A-Z][^|–\-·]{2,40}?)(?:\s*[|–\-·]|$)/);
        if (m2) return m2[1].trim();

        const domain = window.location.hostname.replace(/^www\./, '').split('.')[0];
        const skip = ['jobs', 'careers', 'ats', 'apply', 'boards', 'hire', 'recruiting'];
        if (domain && !skip.includes(domain)) {
          return domain.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        return null;
      }
    });
    return res[0]?.result || null;
  } catch (e) {
    return null;
  }
}

async function resolveExternalCompanyAndScan(slug, displayName) {
  document.getElementById('disambigPanel').innerHTML = '';
  document.getElementById('disambigPanel').style.display = 'none';

  if (detectedExternalCompanyName) {
    const detectedNorm = detectedExternalCompanyName.toLowerCase().trim();
    const slugNorm = slug.toLowerCase();
    const displayNorm = displayName.toLowerCase().trim();
    if (detectedNorm !== slugNorm && detectedNorm !== displayNorm) {
      chrome.storage.local.get('companySlugMap', data => {
        const m = data.companySlugMap || {};
        if (!m[detectedNorm]) { m[detectedNorm] = slug; chrome.storage.local.set({ companySlugMap: m }); }
      });
      addAlias(slug, detectedNorm);
    }
  }

  currentSlug = slug;
  companyEl.textContent = displayName;
  currentVisaStatus = null;
  currentExperience = null;
  currentEmployeeCount = null;
  companyMetaEl.style.display = 'none';
  techStackEl.style.display = 'none';

  const cached = await getCached(slug);
  if (cached) {
    const age = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width = '100%';
    renderResults(cached.recruiters);
    scanBtn.disabled = false;
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = `💡 Showing cached results. Click "Re-scan" to fetch fresh data.`;
    return;
  }

  await runQueuedScan(slug);
  if (scanQueue.length > 0) {
    processQueue();
  } else {
    isScanning = false;
    currentScanSlug = null;
    scanBtn.disabled = false;
    scanBtn.textContent = '🔄 Re-scan';
    renderQueue();
  }
}

function showDisambiguationPanel(companies, searchedName) {
  statusBox.textContent = `Multiple companies found for "${searchedName}" — pick the right one:`;

  const panel = document.getElementById('disambigPanel');
  panel.innerHTML = companies.map(c => {
    const initials = c.name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const logoHtml = c.logoUrl
      ? `<img class="disambig-logo" src="${c.logoUrl}" alt="" />`
      : `<div class="disambig-logo-fallback">${initials}</div>`;
    return `
      <div class="disambig-card">
        ${logoHtml}
        <div class="disambig-info">
          <div class="disambig-name">${c.name}</div>
          ${c.subtitle  ? `<div class="disambig-sub">${c.subtitle}</div>`  : ''}
          ${c.secondary ? `<div class="disambig-sec">${c.secondary}</div>` : ''}
        </div>
        <button class="disambig-pick-btn" data-slug="${c.slug}" data-name="${c.name}">Select</button>
      </div>`;
  }).join('');

  panel.querySelectorAll('.disambig-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => resolveExternalCompanyAndScan(btn.dataset.slug, btn.dataset.name));
  });

  panel.style.display = 'block';
}

async function performExternalSearch() {
  scanBtn.disabled = true;
  scanBtn.textContent = '🔍 Searching...';
  errorDiv.style.display = 'none';
  statusBox.textContent = `🔍 Searching LinkedIn for "${detectedExternalCompanyName}"...`;

  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'searchCompanies', companyName: detectedExternalCompanyName }, resolve)
  );

  if (!response?.success || !response.companies?.length) {
    scanBtn.disabled = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    statusBox.textContent = `⚠️ No LinkedIn companies found for "${detectedExternalCompanyName}".`;
    errorDiv.textContent = `💡 Try the Bulk tab — enter the company's LinkedIn slug (e.g. "vercel", "braze").`;
    errorDiv.style.color = '#0a66c2';
    errorDiv.style.display = 'block';
    return;
  }

  if (response.companies.length === 1) {
    await resolveExternalCompanyAndScan(response.companies[0].slug, response.companies[0].name);
  } else {
    scanBtn.disabled = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    showDisambiguationPanel(response.companies, detectedExternalCompanyName);
  }
}

async function handleExternalPage(tab) {
  currentSlug = null;
  companyEl.textContent = '';
  resultsDiv.innerHTML = '';
  resultsCompanyBanner.style.display = 'none';
  if (copyBtn) copyBtn.style.display = 'none';
  errorDiv.style.display = 'none';
  progressBar.style.display = 'none';
  progressFill.style.width = '0%';

  scanBtn.disabled = true;
  _onJobPage = true;
  statusBox.textContent = '🔍 Detecting company from page...';

  getVisaSponsorshipFromJobPage(tab.id).then(s => showVisaMeta(s));
  getTechStackFromJobPage(tab.id).then(s => showTechStack(s));
  getExperienceFromJobPage(tab.id).then(e => showExperienceMeta(e));
  getEmployeeCountFromJobPage(tab.id).then(c => showCompanyMeta(c));

  let companyName = extractCompanyNameFromUrl(tab.url);
  if (!companyName) companyName = await extractCompanyNameFromPage(tab.id);

  if (!companyName) {
    statusBox.textContent = '⚠️ Could not detect company. Are you on a job posting page?';
    scanBtn.disabled = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    return;
  }

  detectedExternalCompanyName = companyName;
  companyEl.textContent = companyName;

  const earlyHit = await checkCacheByName(companyName);
  if (earlyHit) {
    const { slug, entry } = earlyHit;
    currentSlug = slug;
    companyEl.textContent = entry.displayName || companyName;
    const age = Math.round((Date.now() - entry.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${entry.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width = '100%';
    renderResults(entry.recruiters, entry.logoUrl);
    scanBtn.disabled = false;
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color = '#0a66c2';
    errorDiv.textContent = `💡 Showing cached results. Click "Re-scan" to search LinkedIn again.`;
    return;
  }

  statusBox.textContent = `Click "Find Recruiters" to search LinkedIn for "${companyName}".`;
  scanBtn.disabled = false;
  scanBtn.textContent = '🚀 Find Recruiters';
}
