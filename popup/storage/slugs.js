// -External page state ───────────────────────────────────────────────────────
let detectedExternalCompanyName = null; // set on init; used when button is clicked

// -Extract company slug ──────────────────────────────────────────────────────
function extractCompanySlug(tab) {
  const m = tab.url.match(/linkedin\.com\/company\/([^/?#]+)/);
  return m ? m[1] : null;
}

// -External page: extract company name from the tab URL (no script injection) ─
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

// -External page: extract company name from any job posting page ─────────────
async function extractCompanyNameFromPage(tabId) {
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // 1. JSON-LD hiringOrganization (Greenhouse, Lever, Workday, etc.)
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

        // 2. og:site_name meta tag
        const ogSite = document.querySelector('meta[property="og:site_name"]')?.content;
        if (ogSite) return ogSite;

        // 3. URL patterns for common ATS platforms
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

        // 4. Page title: "Job Title at Company" pattern
        const title = document.title || '';
        let m2 = title.match(/\bat\s+([A-Z][^|–\-·]{2,40}?)(?:\s*[|–\-·]|$)/);
        if (m2) return m2[1].trim();

        // 5. Domain name as last resort (skip generic words)
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

// -Early cache lookup by company name (before any LinkedIn search) ───────────
async function checkCacheByName(companyName) {
  const cache   = await getCache();
  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const slugMap = mapData.companySlugMap || {};

  const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const toSlug    = s => s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const targetNorm = normalize(companyName);
  const targetSlug = toSlug(companyName);

  // 1. Direct slug match
  if (cache[targetSlug]) return { slug: targetSlug, entry: cache[targetSlug] };

  // 2. Via slugMap alias
  const aliasSlug = slugMap[targetSlug] || slugMap[targetNorm];
  if (aliasSlug && cache[aliasSlug]) return { slug: aliasSlug, entry: cache[aliasSlug] };

  // 3. Fuzzy: compare normalized name/slug against every cache entry
  for (const [slug, entry] of Object.entries(cache)) {
    if (normalize(slug) === targetNorm) return { slug, entry };
    if (normalize(entry.displayName || '') === targetNorm) return { slug, entry };
    if ((entry.aliases || []).some(a => normalize(a) === targetNorm)) return { slug, entry };
  }

  return null;
}

// -External page: after company is confirmed, check cache then scan ──────────
async function resolveExternalCompanyAndScan(slug, displayName) {
  document.getElementById('disambigPanel').innerHTML = '';
  document.getElementById('disambigPanel').style.display = 'none';

  // -Auto-learn: store ATS-detected name → resolved slug so future visits skip LinkedIn search ──
  if (detectedExternalCompanyName) {
    const detectedNorm = detectedExternalCompanyName.toLowerCase().trim();
    const slugNorm     = slug.toLowerCase();
    const displayNorm  = displayName.toLowerCase().trim();
    if (detectedNorm !== slugNorm && detectedNorm !== displayNorm) {
      // Store in slugMap for checkCacheByName map lookup
      chrome.storage.local.get('companySlugMap', data => {
        const m = data.companySlugMap || {};
        if (!m[detectedNorm]) { m[detectedNorm] = slug; chrome.storage.local.set({ companySlugMap: m }); }
      });
      // Store in cache entry aliases so it shows in History UI (async, best-effort)
      addAlias(slug, detectedNorm);
    }
  }

  currentSlug = slug;
  companyEl.textContent = displayName;
  currentVisaStatus = null;
  currentExperience = null;
  currentEmployeeCount = null;
  companyMetaEl.style.display = 'none';
  techStackEl.style.display   = 'none';

  const cached = await getCached(slug);
  if (cached) {
    const age     = Math.round((Date.now() - cached.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${cached.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width  = '100%';
    renderResults(cached.recruiters);
    scanBtn.disabled    = false;
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color   = '#0a66c2';
    errorDiv.textContent   = `💡 Showing cached results. Click "Re-scan" to fetch fresh data.`;
    return;
  }

  // No cache — run the scan
  await runQueuedScan(slug);
  if (scanQueue.length > 0) {
    processQueue();
  } else {
    isScanning = false;
    currentScanSlug = null;
    scanBtn.disabled    = false;
    scanBtn.textContent = '🔄 Re-scan';
    renderQueue();
  }
}

// -External page: show company picker when multiple matches found ────────────
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

// -External page: search LinkedIn then disambiguate (triggered by button) ────
async function performExternalSearch() {
  scanBtn.disabled    = true;
  scanBtn.textContent = '🔍 Searching...';
  errorDiv.style.display = 'none';
  statusBox.textContent = `🔍 Searching LinkedIn for "${detectedExternalCompanyName}"...`;

  const response = await new Promise(resolve =>
    chrome.runtime.sendMessage({ action: 'searchCompanies', companyName: detectedExternalCompanyName }, resolve)
  );

  if (!response?.success || !response.companies?.length) {
    scanBtn.disabled    = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    statusBox.textContent = `⚠️ No LinkedIn companies found for "${detectedExternalCompanyName}".`;
    errorDiv.textContent  = `💡 Try the Bulk tab — enter the company's LinkedIn slug (e.g. "vercel", "braze").`;
    errorDiv.style.color  = '#0a66c2';
    errorDiv.style.display = 'block';
    return;
  }

  if (response.companies.length === 1) {
    await resolveExternalCompanyAndScan(response.companies[0].slug, response.companies[0].name);
  } else {
    scanBtn.disabled    = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    showDisambiguationPanel(response.companies, detectedExternalCompanyName);
  }
}

// -External page: on panel open — detect name only, wait for button click ────
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
  _onJobPage = true; // external pages are always job postings
  statusBox.textContent = '🔍 Detecting company from page...';

  // Run meta extraction in parallel (visa, tech, exp — all read from current page)
  getVisaSponsorshipFromJobPage(tab.id).then(s => showVisaMeta(s));
  getTechStackFromJobPage(tab.id).then(s => showTechStack(s));
  getExperienceFromJobPage(tab.id).then(e => showExperienceMeta(e));
  getEmployeeCountFromJobPage(tab.id).then(c => showCompanyMeta(c));

  // Try URL-based extraction first (instant, no script injection — works even on CSP-strict pages)
  let companyName = extractCompanyNameFromUrl(tab.url);

  // Fall back to full script injection (JSON-LD, meta tags, page title, domain)
  if (!companyName) companyName = await extractCompanyNameFromPage(tab.id);

  if (!companyName) {
    statusBox.textContent = '⚠️ Could not detect company. Are you on a job posting page?';
    scanBtn.disabled    = false;
    scanBtn.textContent = '🚀 Find Recruiters';
    return;
  }

  detectedExternalCompanyName = companyName;
  companyEl.textContent = companyName;

  // Early cache check — no LinkedIn search needed if we already have this company
  const earlyHit = await checkCacheByName(companyName);
  if (earlyHit) {
    const { slug, entry } = earlyHit;
    currentSlug = slug;
    companyEl.textContent = entry.displayName || companyName;
    const age     = Math.round((Date.now() - entry.scannedAt) / 60000);
    const ageText = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    statusBox.textContent = `✅ Loaded from cache (scanned ${ageText}). ${entry.recruiters.length} recruiters.`;
    progressBar.style.display = 'block';
    progressFill.style.width  = '100%';
    renderResults(entry.recruiters, entry.logoUrl);
    scanBtn.disabled    = false;
    scanBtn.textContent = '🔄 Re-scan';
    errorDiv.style.display = 'block';
    errorDiv.style.color   = '#0a66c2';
    errorDiv.textContent   = `💡 Showing cached results. Click "Re-scan" to search LinkedIn again.`;
    return;
  }

  statusBox.textContent = `Click "Find Recruiters" to search LinkedIn for "${companyName}".`;
  scanBtn.disabled    = false;
  scanBtn.textContent = '🚀 Find Recruiters';
}

async function getCompanySlugFromJobPage(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const url = window.location.href;
      let jobId = (url.match(/\/jobs\/view\/(\d+)/) || [])[1];
      if (!jobId) jobId = (url.match(/currentJobId=(\d+)/) || [])[1];
      if (!jobId) jobId = (url.match(/\/jobs\/(\d+)/) || [])[1];
      if (!jobId) return null;
      try {
        const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;
        const res = await fetch(apiUrl, { headers: { 'Accept': 'text/html' }, credentials: 'include' });
        const html = await res.text();
        const m = html.match(/\/company\/([a-zA-Z0-9_-]+)/);
        if (m && m[1] && !['linkedin'].includes(m[1])) return m[1];
      } catch (e) {}
      function isVisible(el) {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      const allCompanyLinks = [...document.querySelectorAll('a[href*="/company/"]')];
      for (const el of allCompanyLinks) {
        if (!isVisible(el)) continue;
        const m = el.href.match(/\/company\/([^/?#]+)/);
        if (!m || !m[1]) continue;
        if (['linkedin', 'jobs'].includes(m[1].toLowerCase())) continue;
        return m[1];
      }
      return null;
    }
  });
  return results[0]?.result || null;
}

// -Update Slugs button (in history panel) ────────────────────────────────────
document.getElementById('updateSlugsBtn').addEventListener('click', async () => {
  const btn = document.getElementById('updateSlugsBtn');
  const cache = await getCache();
  const slugs = Object.keys(cache);
  if (!slugs.length) {
    globalThis.setHistoryActionStatus?.('Nothing to update');
    btn.textContent = '🔗 Nothing to update';
    setTimeout(() => { btn.textContent = '🔗 Update Slugs'; }, 2000);
    return;
  }

  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const slugMap = mapData.companySlugMap || {};
  let updated = 0;

  const normalize = s => String(s || '').toLowerCase().trim();
  const normalizeUrl = url => (url || '').split('?')[0].replace(/\/$/, '').toLowerCase();
  const mergeRecruiters = (left = [], right = []) => {
    const out = [];
    const seen = new Set();
    for (const recruiter of [...left, ...right]) {
      const key = normalizeUrl(recruiter?.url);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(recruiter);
    }
    return out;
  };

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    if (!cache[slug]) continue; // entry may already have been migrated earlier in this run
    globalThis.setHistoryActionStatus?.(`Updating ${i + 1}/${slugs.length}`, 0);
    btn.textContent = `🔗 Updating… ${i + 1}/${slugs.length}`;

    // Always store self-mapping so we know this slug is canonical
    if (!slugMap[slug]) { slugMap[slug] = slug; updated++; }

    // Fetch to detect redirects (e.g. onepay → joinonepay)
    try {
      const resp = await fetch(`https://www.linkedin.com/company/${slug}/`, {
        redirect: 'follow', credentials: 'include',
      });
      const m = resp.url.match(/\/company\/([^/?#]+)/);
      if (m && !/^\d+$/.test(m[1])) {
        const canonical = m[1].toLowerCase();
        // If LinkedIn redirected to a different slug, canonicalize the cache entry too.
        if (canonical !== slug) {
          const oldEntry = cache[slug];
          const canonicalEntry = cache[canonical];

          cache[canonical] = canonicalEntry ? {
            recruiters: mergeRecruiters(canonicalEntry.recruiters, oldEntry?.recruiters),
            logoUrl: canonicalEntry.logoUrl || oldEntry?.logoUrl || null,
            scannedAt: Math.max(canonicalEntry.scannedAt || 0, oldEntry?.scannedAt || 0),
            displayName: canonicalEntry.displayName || oldEntry?.displayName || canonical.replace(/-/g, ' '),
            employeeCount: canonicalEntry.employeeCount || oldEntry?.employeeCount,
            aliases: [...new Set([
              ...(canonicalEntry.aliases || []).map(normalize),
              ...(oldEntry?.aliases || []).map(normalize),
              normalize(slug),
            ].filter(Boolean))],
          } : {
            ...oldEntry,
            displayName: oldEntry?.displayName || canonical.replace(/-/g, ' '),
            aliases: [...new Set([...(oldEntry?.aliases || []).map(normalize), normalize(slug)].filter(Boolean))],
          };

          if (canonical !== slug) delete cache[slug];

          Object.keys(slugMap).forEach(key => {
            if (slugMap[key] === slug) slugMap[key] = canonical;
          });
          slugMap[canonical] = canonical;
          slugMap[slug] = canonical;
          for (const alias of cache[canonical].aliases || []) {
            slugMap[alias] = canonical;
          }
          updated++;
        }
      }
    } catch {}

    // Small delay to avoid hammering LinkedIn
    await new Promise(r => setTimeout(r, 400));
  }

  await chrome.storage.local.set({ [CACHE_KEY]: cache, companySlugMap: slugMap });
  await syncHistoryAliasesFromSlugMap();
  globalThis.setHistoryActionStatus?.(`Update slugs done: ${updated} updated`);
  btn.textContent = `✅ Done — ${updated} slug${updated !== 1 ? 's' : ''} updated`;
  setTimeout(() => { btn.textContent = '🔗 Update Slugs'; }, 3000);
});
