// -Bulk search ───────────────────────────────────────────────────────────────
function parseCompanyNames(text) {
  return text
    .split(/[\n,]+/)
    .map(s => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean);
}

bulkSearchBtn.addEventListener('click', async () => {
  const slugs = parseCompanyNames(bulkTextarea.value);
  if (slugs.length === 0) {
    bulkStatus.textContent = '⚠️ Enter at least one company name.';
    return;
  }

  const forceRescan = bulkForceRescan.checked;
  bulkSearchBtn.disabled = true;
  bulkResultsDiv.innerHTML = '';
  bulkProgressBar.style.display = 'block';
  bulkProgressFill.style.width = '0%';

  const summary = [];

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const displayName = slug.replace(/-/g, ' ');
    bulkStatus.textContent = `Scanning ${i + 1} / ${slugs.length}: ${displayName}...`;
    bulkProgressFill.style.width = `${(i / slugs.length) * 100}%`;

    if (!forceRescan) {
      const cached = await getCached(slug);
      if (cached) {
        summary.push({ slug, count: cached.recruiters.length, fromCache: true });
        continue;
      }
    } else {
      await deleteFromCache(slug);
    }

    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'start', companySlug: slug }, resolve);
    });

    if (response?.success) {
      if (response.data.length > 0) await saveToCache(slug, response.data);
      summary.push({ slug, count: response.data.length, fromCache: false });
    } else {
      summary.push({ slug, count: null, fromCache: false });
    }
  }

  bulkProgressFill.style.width = '100%';
  bulkStatus.textContent = `✅ Done! Scanned ${slugs.length} compan${slugs.length === 1 ? 'y' : 'ies'}.`;
  bulkSearchBtn.disabled = false;

  bulkResultsDiv.innerHTML = summary.map(({ slug, count, fromCache }) => {
    const name = slug.replace(/-/g, ' ');
    if (count === null) {
      return `<div class="bulk-result-card error">
        <span class="bulk-result-name">${name}</span>
        <span class="bulk-result-count" style="color:#c0392b">Error</span>
      </div>`;
    }
    const cls = fromCache ? 'cached' : '';
    const label = fromCache
      ? `${count} recruiters (cached)`
      : `${count} recruiters found`;
    return `<div class="bulk-result-card ${cls}">
      <span class="bulk-result-name">${name}</span>
      <span class="bulk-result-count">${label}</span>
    </div>`;
  }).join('');
});
