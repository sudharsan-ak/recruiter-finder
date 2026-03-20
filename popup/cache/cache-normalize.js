async function syncHistoryAliasesFromSlugMap() {
  const [cache, mapData] = await Promise.all([
    getCache(),
    new Promise(resolve => chrome.storage.local.get('companySlugMap', resolve)),
  ]);
  const slugMap = mapData.companySlugMap || {};
  let changed = false;

  for (const [alias, slug] of Object.entries(slugMap)) {
    if (!cache[slug]) continue;
    const normalizedAlias = String(alias || '').toLowerCase().trim();
    if (!normalizedAlias || normalizedAlias === slug) continue;
    if (!cache[slug].aliases) cache[slug].aliases = [];
    if (cache[slug].aliases.includes(normalizedAlias)) continue;
    cache[slug].aliases.push(normalizedAlias);
    changed = true;
  }

  if (!changed) return false;
  await new Promise(resolve => chrome.storage.local.set({ [CACHE_KEY]: cache }, resolve));
  return true;
}

async function syncSlugMapFromHistory() {
  const [cache, mapData] = await Promise.all([
    getCache(),
    new Promise(resolve => chrome.storage.local.get('companySlugMap', resolve)),
  ]);
  const slugMap = mapData.companySlugMap || {};
  let changed = false;

  for (const [slug, entry] of Object.entries(cache)) {
    if (slugMap[slug] !== slug) {
      slugMap[slug] = slug;
      changed = true;
    }

    const displayNorm = String(entry?.displayName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const slugNorm = slug.toLowerCase().replace(/-/g, '');
    if (displayNorm && displayNorm !== slugNorm && slugMap[displayNorm] !== slug) {
      slugMap[displayNorm] = slug;
      changed = true;
    }

    for (const alias of entry?.aliases || []) {
      const normalizedAlias = String(alias || '').toLowerCase().trim();
      if (!normalizedAlias || slugMap[normalizedAlias] === slug) continue;
      slugMap[normalizedAlias] = slug;
      changed = true;
    }
  }

  if (!changed) return false;
  await new Promise(resolve => chrome.storage.local.set({ companySlugMap: slugMap }, resolve));
  return true;
}
