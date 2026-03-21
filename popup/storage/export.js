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
  const rows = [['Name', 'Company', 'Company LinkedIn Page', 'Role', 'LinkedIn URL', 'Email']];

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
          escapeCSV(r.url),
          escapeCSV(r.email || '')
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

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows.filter(r => r.some(cellVal => String(cellVal || '').trim()));
}

function normalizeHeader(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function slugifyCompanyName(companyName) {
  return String(companyName || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function mergeRecruiterLists(existingRecruiters = [], incomingRecruiters = []) {
  const merged = normalizeRecruiters(existingRecruiters);
  const byUrl = new Map(merged.map(r => [normalizeRecruiterUrl(r.url), r]));

  normalizeRecruiters(incomingRecruiters).forEach(recruiter => {
    const key = normalizeRecruiterUrl(recruiter.url);
    const existing = byUrl.get(key);
    if (!existing) {
      merged.push(recruiter);
      byUrl.set(key, recruiter);
      return;
    }
    if (recruiter.name) existing.name = recruiter.name;
    if (recruiter.title) existing.title = recruiter.title;
    if (recruiter.photoUrl && !existing.photoUrl) existing.photoUrl = recruiter.photoUrl;
    if (recruiter.email) existing.email = recruiter.email;
  });

  return merged;
}

async function importJsonBackup(text) {
  const data = JSON.parse(text);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error();

  const incoming = data.recruiters ?? data;
  const incomingAliases = data.companySlugMap ?? {};
  const currentCache = await getCache();
  const merged = { ...currentCache };

  for (const [slug, entry] of Object.entries(incoming || {})) {
    const existing = merged[slug] || {};
    merged[slug] = {
      ...existing,
      ...entry,
      recruiters: mergeRecruiterLists(existing.recruiters || [], entry.recruiters || []),
      aliases: [...new Set([...(existing.aliases || []), ...(entry.aliases || [])])],
      displayName: entry.displayName || existing.displayName || slug.replace(/-/g, ' '),
      logoUrl: entry.logoUrl ?? existing.logoUrl ?? null,
      employeeCount: entry.employeeCount ?? existing.employeeCount,
      scannedAt: Math.max(existing.scannedAt || 0, entry.scannedAt || 0, Date.now()),
    };
  }

  const mapData = await new Promise(r => chrome.storage.local.get('companySlugMap', r));
  const mergedAliases = { ...(mapData.companySlugMap || {}), ...incomingAliases };
  await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: merged, companySlugMap: mergedAliases }, r));
  await syncSlugMapFromHistory();
  await syncHistoryAliasesFromSlugMap();
  return { companyCount: Object.keys(incoming || {}).length, recruiterCount: 0, mode: 'json' };
}

async function importCsvFile(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('CSV is empty');

  const header = rows[0].map(normalizeHeader);
  const idx = {
    name: header.indexOf('name'),
    company: header.indexOf('company'),
    companyLinkedIn: Math.max(header.indexOf('companylinkedinpage'), header.indexOf('companylinkedinurl')),
    role: Math.max(header.indexOf('role'), header.indexOf('title')),
    linkedinUrl: Math.max(header.indexOf('linkedinurl'), header.indexOf('profileurl')),
    email: header.indexOf('email'),
  };

  if (idx.company === -1) throw new Error('CSV must include a Company column');

  const cache = await getCache();
  const touchedCompanies = new Set();
  let recruiterCount = 0;

  for (const row of rows.slice(1)) {
    const companyName = String(row[idx.company] || '').trim();
    const companyLinkedIn = idx.companyLinkedIn >= 0 ? String(row[idx.companyLinkedIn] || '').trim() : '';
    const role = idx.role >= 0 ? String(row[idx.role] || '').trim() : '';
    const profileUrl = idx.linkedinUrl >= 0 ? normalizeRecruiterUrl(row[idx.linkedinUrl]) : '';
    const recruiterName = idx.name >= 0 ? String(row[idx.name] || '').trim() : '';
    const email = idx.email >= 0 ? String(row[idx.email] || '').trim().toLowerCase() : '';

    if (!companyName && !companyLinkedIn) continue;

    let slug = '';
    const companyMatch = companyLinkedIn.match(/linkedin\.com\/company\/([^/?#]+)/i);
    if (companyMatch) {
      slug = companyMatch[1].toLowerCase();
    } else if (companyName) {
      const cachedMatch = await checkCacheByName(companyName);
      slug = cachedMatch?.slug || slugifyCompanyName(companyName);
    }
    if (!slug) continue;
    touchedCompanies.add(slug);

    const existing = cache[slug] || {
      recruiters: [],
      logoUrl: null,
      scannedAt: Date.now(),
      displayName: companyName || slug.replace(/-/g, ' '),
      aliases: [],
    };

    if (!cache[slug]) {
      cache[slug] = existing;
    }

    if (companyName && !existing.displayName) existing.displayName = companyName;

    if (profileUrl || recruiterName) {
      const recruiter = normalizeRecruiter({
        name: recruiterName,
        title: role,
        url: profileUrl,
        email,
      });
      const existingRecruiter = existing.recruiters.find(r => normalizeRecruiterUrl(r.url) === normalizeRecruiterUrl(profileUrl));
      if (existingRecruiter) {
        if (recruiter.name) existingRecruiter.name = recruiter.name;
        if (recruiter.title) existingRecruiter.title = recruiter.title;
        if (recruiter.email) existingRecruiter.email = recruiter.email;
      } else {
        existing.recruiters.push(recruiter);
      }
      recruiterCount += 1;
    }
  }

  await new Promise(r => chrome.storage.local.set({ [CACHE_KEY]: cache }, r));
  await syncSlugMapFromHistory();
  await syncHistoryAliasesFromSlugMap();
  return { companyCount: touchedCompanies.size, recruiterCount, mode: 'csv' };
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const isCsv = /\.csv$/i.test(file.name) || /^text\/csv/i.test(file.type);
    const result = isCsv ? await importCsvFile(text) : await importJsonBackup(text);

    if (result.mode === 'csv') {
      globalThis.setHistoryActionStatus?.(`CSV import done: ${result.recruiterCount} recruiters`);
      importBackupBtn.textContent = `✅ Imported ${result.recruiterCount} recruiter${result.recruiterCount === 1 ? '' : 's'}`;
    } else {
      globalThis.setHistoryActionStatus?.(`Import done: ${result.companyCount} companies`);
      importBackupBtn.textContent = `✅ Imported ${result.companyCount} companies`;
    }
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
