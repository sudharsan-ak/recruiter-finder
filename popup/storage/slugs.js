function extractCompanySlug(tab) {
  const m = tab.url.match(/linkedin\.com\/company\/([^/?#]+)/);
  return m ? m[1] : null;
}

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
