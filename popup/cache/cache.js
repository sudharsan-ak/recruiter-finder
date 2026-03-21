// -Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_KEY = 'recruiterHistory';

function normalizeRecruiterUrl(url) {
  return String(url || '').split('?')[0].replace(/\/$/, '').trim();
}

function normalizeRecruiter(recruiter = {}) {
  return {
    name: String(recruiter.name || '').trim(),
    title: String(recruiter.title || '').trim(),
    url: normalizeRecruiterUrl(recruiter.url),
    photoUrl: recruiter.photoUrl || recruiter.photo || '',
    email: String(recruiter.email || '').trim().toLowerCase(),
  };
}

function normalizeRecruiters(recruiters = []) {
  return recruiters.map(normalizeRecruiter).filter(r => r.url || r.name);
}

async function getCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([CACHE_KEY], data => resolve(data[CACHE_KEY] || {}));
  });
}

async function saveToCache(slug, recruiters, logoUrl = null) {
  const cache = await getCache();
  const existing = cache[slug] || {};
  cache[slug] = {
    recruiters: normalizeRecruiters(recruiters),
    logoUrl: logoUrl ?? existing.logoUrl ?? null,
    scannedAt: Date.now(),
    displayName: existing.displayName || slug.replace(/-/g, ' '),
    employeeCount: existing.employeeCount,
    aliases: existing.aliases || [],
  };
  // Register this slug in the alias map so profile page lookups can find it.
  // Stores slug → slug (self-mapping) meaning "this is a known canonical slug".
  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const slugMap = mapData.companySlugMap || {};
  slugMap[slug] = slug;
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache, companySlugMap: slugMap }, resolve);
  });
}

async function getCached(slug) {
  const cache = await getCache();
  return cache[slug] || null;
}

async function deleteFromCache(slug) {
  const cache = await getCache();
  delete cache[slug];
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

async function removeRecruiterFromCache(slug, url) {
  const cache = await getCache();
  if (!cache[slug]) return;
  const normalized = normalizeRecruiterUrl(url);
  cache[slug].recruiters = cache[slug].recruiters.filter(r => normalizeRecruiterUrl(r.url) !== normalized);
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve);
  });
}

async function upsertRecruiterEmail(slug, url, email) {
  const cache = await getCache();
  if (!cache[slug]) return false;
  const normalizedUrl = normalizeRecruiterUrl(url);
  const recruiter = cache[slug].recruiters.find(r => normalizeRecruiterUrl(r.url) === normalizedUrl);
  if (!recruiter) return false;
  recruiter.email = String(email || '').trim().toLowerCase();
  await new Promise(resolve => chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve));
  return true;
}

async function renameCompanyInCache(slug, newName) {
  const cache = await getCache();
  if (!cache[slug]) return;
  cache[slug].displayName = newName;
  const normalized = newName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const slugNorm = slug.toLowerCase().replace(/-/g, '');
  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const slugMap = mapData.companySlugMap || {};
  if (normalized && normalized !== slugNorm) {
    if (!cache[slug].aliases) cache[slug].aliases = [];
    if (!cache[slug].aliases.includes(normalized)) cache[slug].aliases.push(normalized);
    slugMap[normalized] = slug;
  }
  return new Promise(resolve => {
    chrome.storage.local.set({ [CACHE_KEY]: cache, companySlugMap: slugMap }, resolve);
  });
}

async function addAlias(slug, alias) {
  const normalized = alias.toLowerCase().trim();
  if (!normalized) return;
  const cache = await getCache();
  if (!cache[slug]) return;
  if (!cache[slug].aliases) cache[slug].aliases = [];
  if (cache[slug].aliases.includes(normalized)) return;
  cache[slug].aliases.push(normalized);
  // Also register in companySlugMap so checkCacheByName finds it via map too
  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const slugMap = mapData.companySlugMap || {};
  slugMap[normalized] = slug;
  return new Promise(resolve => chrome.storage.local.set({ [CACHE_KEY]: cache, companySlugMap: slugMap }, resolve));
}

async function removeAlias(slug, alias) {
  const cache = await getCache();
  if (!cache[slug]?.aliases) return;
  cache[slug].aliases = cache[slug].aliases.filter(a => a !== alias);
  // Remove from companySlugMap too
  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const slugMap = mapData.companySlugMap || {};
  if (slugMap[alias] === slug) delete slugMap[alias];
  return new Promise(resolve => chrome.storage.local.set({ [CACHE_KEY]: cache, companySlugMap: slugMap }, resolve));
}
