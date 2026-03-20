// -Shared copy helper ────────────────────────────────────────────────────────
function copyLink(url, btn, originalText) {
  navigator.clipboard.writeText(url).then(() => {
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.textContent = originalText; }, 2000);
  });
}

// -CSV export ────────────────────────────────────────────────────────────────
function escapeCSV(val) {
  const str = (val || '').toString().replace(/"/g, '""');
  // Wrap in quotes if it contains comma, newline or quote
  return /[",\n]/.test(str) ? `"${str}"` : str;
}

async function exportToCSV() {
  const cache = await getCache();
  const keys  = Object.keys(cache).sort((a, b) => cache[b].scannedAt - cache[a].scannedAt);

  if (keys.length === 0) {
    globalThis.setHistoryActionStatus?.('Nothing to export');
    exportCsvBtn.textContent = '⚠️ Nothing to export';
    setTimeout(() => { exportCsvBtn.textContent = '⬇️ Export to CSV'; }, 2000);
    return;
  }

  // Header row
  const rows = [['Name', 'Company', 'Company LinkedIn Page', 'Role', 'LinkedIn URL']];

  keys.forEach(slug => {
    const entry           = cache[slug];
    const companyName     = entry.displayName || slug.replace(/-/g, ' ');
    const companyLinkedIn = `https://www.linkedin.com/company/${slug}/`;

    if (entry.recruiters.length === 0) {
      // Still include the company row with empty recruiter fields
      rows.push(['', companyName, companyLinkedIn, '', '']);
    } else {
      entry.recruiters.forEach(r => {
        rows.push([
          escapeCSV(r.name),
          escapeCSV(companyName),
          escapeCSV(companyLinkedIn),
          escapeCSV(r.title),
          escapeCSV(r.url)
        ]);
      });
    }
  });

  const csvContent = rows.map(row => row.join(',')).join('\n');
  const blob       = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const blobUrl    = URL.createObjectURL(blob);

  // Build filename with today's date
  const date     = new Date();
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const filename = `linkedin-recruiters-${datePart}.csv`;

  // Trigger download via a temporary <a> tag
  const a    = document.createElement('a');
  a.href     = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);

  globalThis.setHistoryActionStatus?.('Export CSV done');
  exportCsvBtn.textContent = '✅ Exported!';
  setTimeout(() => { exportCsvBtn.textContent = '⬇️ Export to CSV'; }, 2000);
}

// -Backup export ─────────────────────────────────────────────────────────────
async function exportBackup() {
  const cache   = await getCache();
  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const backup  = { recruiters: cache, companySlugMap: mapData.companySlugMap || {} };
  const blob  = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url   = URL.createObjectURL(blob);
  const date  = new Date();
  const dp    = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const a     = document.createElement('a');
  a.href = url; a.download = `recruiter-backup-${dp}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  globalThis.setHistoryActionStatus?.('Export backup done');
  exportBackupBtn.textContent = '✅ Exported!';
  setTimeout(() => { exportBackupBtn.textContent = '⬇ Export Backup'; }, 2000);
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error();

    // Support both old format (flat cache object) and new format ({ recruiters, companySlugMap })
    const incoming        = data.recruiters ?? data;
    const incomingAliases = data.companySlugMap ?? {};

    const merged = { ...(await getCache()), ...incoming };
    const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
    const mergedAliases = { ...(mapData.companySlugMap || {}), ...incomingAliases };

    await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: merged, companySlugMap: mergedAliases }, r));
    await syncSlugMapFromHistory();
    await syncHistoryAliasesFromSlugMap();
    globalThis.setHistoryActionStatus?.(`Import done: ${Object.keys(incoming).length} companies`);
    importBackupBtn.textContent = `✅ Imported ${Object.keys(incoming).length} companies`;
    setTimeout(() => { importBackupBtn.textContent = '⬆ Import Backup'; }, 3000);
    renderHistory(historySearch.value);
  } catch {
    globalThis.setHistoryActionStatus?.('Import failed');
    importBackupBtn.textContent = '❌ Invalid file';
    setTimeout(() => { importBackupBtn.textContent = '⬆ Import Backup'; }, 2500);
  }
}

exportCsvBtn.addEventListener('click', exportToCSV);
exportBackupBtn.addEventListener('click', exportBackup);
importBackupBtn.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) { importBackup(file); importFileInput.value = ''; }
});
