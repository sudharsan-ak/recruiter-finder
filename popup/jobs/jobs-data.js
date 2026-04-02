// ── Jobs Shared State & Data Layer ───────────────────────────────────────────

const JOBS_STACK_KEY    = 'myJobStack';
const JOBS_RESULTS_KEY  = 'jobScanResults';
const JOBS_STATE_KEY    = 'jobScanState';
const JOBS_MAX_KEY      = 'jobScanMax';
const JOBS_HASH_KEY     = 'jobScanHashIndex';   // Tier 1: flat hash array
const JOBS_HISTORY_KEY  = 'jobScanHistory';     // Tier 2: metadata array (capped 10k)
const JOBS_HISTORY_CAP  = 10000;
const JOBS_MATCH_CACHE  = 'jobMatchCache';      // { [jobId]: string[] } matched tag names
const JOBS_JD_CACHE     = 'jobJDCache';         // [[jobId, jdText], ...] newest first, cap 500
const JOBS_JD_CACHE_CAP = 10000;

// ── Shared mutable state (read/written by results + seen tabs) ────────────────
let _jobStack            = [];
let _jobResults          = [];
let _jobState            = { running: false, total: 0, done: 0 };
let _selectedIds         = new Set();
let _filterMatchingOnly  = false;
let _visibleJobIds       = null;
let _urlMismatch         = false;
let _maxJobs             = 25;
let _expandedCardId      = null;
let _collapseListener    = null;
let _companyFilter       = '';
let _activeJobsSubTab    = 'results';  // 'results' | 'seen'
let _jobMatchCache       = {};         // jobId → matched tag names[]
let _onLinkedInJobsPage  = false;      // true only when active tab is linkedin.com/jobs
let _jobJDCache          = {};         // jobId → jdText (built from _jobJDCacheArr)
let _jobJDCacheArr       = [];         // [[jobId, jdText], ...] newest first, capped

const jobsMain = document.getElementById('jobsMain');

// ── Storage helpers ───────────────────────────────────────────────────────────

async function loadJobsData() {
  const d = await new Promise(r =>
    chrome.storage.local.get([JOBS_STACK_KEY, JOBS_RESULTS_KEY, JOBS_STATE_KEY, JOBS_MAX_KEY, JOBS_MATCH_CACHE, JOBS_JD_CACHE], r)
  );
  _jobStack      = d[JOBS_STACK_KEY]   || [];
  _jobResults    = d[JOBS_RESULTS_KEY] || [];
  _jobState      = d[JOBS_STATE_KEY]   || { running: false, total: 0, done: 0 };
  _maxJobs       = d[JOBS_MAX_KEY]     ?? 25;
  _jobMatchCache = d[JOBS_MATCH_CACHE] || {};
  _jobJDCacheArr = d[JOBS_JD_CACHE]    || [];
  _jobJDCache    = Object.fromEntries(_jobJDCacheArr);
}

// Save new JD texts into the persistent cache (newest first, capped)
function saveJDCache(newEntries) {
  // newEntries: { [jobId]: jdText }
  const existing = new Map(_jobJDCacheArr);
  for (const [id, text] of Object.entries(newEntries)) {
    if (text) existing.set(id, text);
  }
  // Rebuild newest-first by prepending new ones, keeping order stable for old ones
  const newIds = new Set(Object.keys(newEntries));
  const kept   = _jobJDCacheArr.filter(([id]) => !newIds.has(id));
  const added  = Object.entries(newEntries).filter(([, t]) => t);
  _jobJDCacheArr = [...added, ...kept].slice(0, JOBS_JD_CACHE_CAP);
  _jobJDCache    = Object.fromEntries(_jobJDCacheArr);
  chrome.storage.local.set({ [JOBS_JD_CACHE]: _jobJDCacheArr }).catch(() => {});
}

async function saveStack() {
  await chrome.storage.local.set({ [JOBS_STACK_KEY]: _jobStack });
}

async function findLinkedInJobsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.linkedin.com/jobs/*' });
  return tabs[0] || null;
}

function normalizeJobUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('currentJobId');
    return u.origin + u.pathname + u.search;
  } catch { return url; }
}

function matchStack(jdText, stack) {
  if (!jdText || !stack.length) return [];
  return stack.filter(tag => {
    const pat = (typeof TECH_PATTERNS !== 'undefined')
      ? TECH_PATTERNS.find(([label]) => label === tag)
      : null;
    if (pat) return new RegExp(pat[1], pat[2]).test(jdText);
    return jdText.toLowerCase().includes(tag.toLowerCase());
  });
}

// ── Seen jobs history helpers ─────────────────────────────────────────────────

async function loadSeenHistory() {
  const d = await new Promise(r =>
    chrome.storage.local.get([JOBS_HASH_KEY, JOBS_HISTORY_KEY], r)
  );
  return {
    hashIndex: d[JOBS_HASH_KEY]   || [],
    history:   d[JOBS_HISTORY_KEY] || [],
  };
}

async function saveSeenHistory(hashIndex, history) {
  await chrome.storage.local.set({
    [JOBS_HASH_KEY]:   hashIndex,
    [JOBS_HISTORY_KEY]: history,
  });
}

// Remove entries matching a predicate from both tiers, return count removed
async function clearSeenByPredicate(predicate) {
  const { hashIndex, history } = await loadSeenHistory();
  const toRemove = new Set(history.filter(predicate).map(e => e[0]));
  const newHistory  = history.filter(e => !toRemove.has(e[0]));
  const newHashIndex = hashIndex.filter(h => !toRemove.has(h));
  await saveSeenHistory(newHashIndex, newHistory);
  return toRemove.size;
}

function formatSeenDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
